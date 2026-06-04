import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError
} from "../errors.js";
import { createArtifactPlan, writeArtifactMetadata } from "../output/artifacts.js";
import type { GFlowJob } from "../jobs/schema.js";
import type { FlowAutomation, FlowAutomationRunInput, FlowJobResult } from "./types.js";
import { flowLocators } from "./locators.js";

export const FLOW_URL = "https://labs.google/fx/tools/flow";

// Flow's aspect-ratio buttons render a Material icon ligature prefix; this maps the visible
// ratio label to that ligature so we can target the right popover button.
const RATIO_ICON: Record<string, string> = {
  "16:9": "crop_16_9",
  "9:16": "crop_9_16",
  "4:3": "crop_landscape",
  "1:1": "crop_square",
  "3:4": "crop_portrait"
};

interface FetchedMedia {
  bytes: Buffer;
  contentType: string | undefined;
}

// Result media are served from authenticated URLs like
// labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<uuid>. Fetching them through the
// logged-in browser context returns the real bytes; an in-page fetch() returns the SPA HTML.
async function fetchMedia(context: BrowserContext, src: string): Promise<FetchedMedia> {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    const meta = src.slice(5, comma);
    const payload = src.slice(comma + 1);
    const bytes = meta.includes("base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return { bytes, contentType: meta.split(";")[0] || undefined };
  }
  const response = await context.request.get(src);
  if (!response.ok()) {
    throw new GenerationFailedError(`Failed to download a result (HTTP ${response.status()}).`);
  }
  return { bytes: Buffer.from(await response.body()), contentType: response.headers()["content-type"] };
}

function extensionFor(type: "image" | "video", contentType: string | undefined): string {
  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("mp4") || contentType?.includes("video")) return ".mp4";
  return type === "video" ? ".mp4" : ".png";
}

export class FlowPage implements FlowAutomation {
  constructor(private readonly page: Page, private readonly flowUrl = FLOW_URL) {}

  async open(): Promise<void> {
    await this.page.goto(this.flowUrl, { waitUntil: "domcontentloaded" });
    // Flow is a single-page app. Wait for either the signed-in dashboard or, when already
    // inside a project, the prompt box. A login/consent wall shows neither, so the wait
    // times out and assertReady() reports the real problem.
    const locators = flowLocators(this.page);
    await locators.promptBox
      .first()
      .or(locators.dashboardMarker.first())
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => undefined);
  }

  async assertReady(): Promise<void> {
    const locators = flowLocators(this.page);

    // A signed-in session shows the Flow dashboard (project list) or, inside a project, the
    // prompt box. Either one means we are authenticated and ready.
    const dashboardReady = await locators.dashboardMarker.first().isVisible().catch(() => false);
    const promptReady = (await locators.promptBox.count()) > 0;
    if (dashboardReady || promptReady) return;

    if (await locators.manualActionMarker.first().isVisible().catch(() => false)) {
      throw new ManualActionRequiredError("Flow requires login, consent, or verification.");
    }
    throw new LoginRequiredError();
  }

  async runJob(input: FlowAutomationRunInput): Promise<FlowJobResult> {
    const locators = flowLocators(this.page);
    await this.ensureProject();
    await this.assertReady();
    await this.applySettings(input.job);

    if (input.job.type === "video") {
      if (input.job.startFrame) await this.uploadFrame("Start", input.job.startFrame);
      if (input.job.endFrame) await this.uploadFrame("End", input.job.endFrame);
    }

    if ((await locators.promptBox.count()) === 0) {
      throw new GenerationFailedError("Could not find the Flow prompt box. Open or create a project first.");
    }

    const before = new Set(await this.resultSrcs(input.job.type));
    await this.fillPrompt(input.job.prompt);
    await this.submit();

    const generationTimeoutSeconds = input.job.timeout ?? (input.job.type === "video" ? 1800 : 900);
    const newSrcs = await this.waitForResults(before, input.job.outputs, generationTimeoutSeconds * 1000, input.job.type);

    const context = this.page.context();
    const artifacts = [];
    for (let index = 0; index < Math.min(input.job.outputs, newSrcs.length); index += 1) {
      const media = await fetchMedia(context, newSrcs[index]);
      const plan = createArtifactPlan({
        outDir: input.outDir,
        jobId: input.job.id,
        index: index + 1,
        extension: extensionFor(input.job.type, media.contentType)
      });
      await mkdir(dirname(plan.assetPath), { recursive: true });
      await writeFile(plan.assetPath, media.bytes);
      await writeArtifactMetadata(plan.metadataPath, {
        jobId: input.job.id,
        type: input.job.type,
        prompt: input.job.prompt,
        project: input.job.project,
        model: input.job.model,
        ratio: input.job.ratio,
        duration: input.job.type === "video" ? input.job.duration : undefined,
        requestedOutputs: input.job.outputs,
        downloadedAt: new Date().toISOString(),
        source: "google-flow-browser",
        flowUrl: this.page.url(),
        status: "downloaded"
      });
      artifacts.push({ path: plan.assetPath, metadataPath: plan.metadataPath });
    }

    if (artifacts.length === 0) {
      throw new GenerationFailedError("No downloadable results appeared.");
    }

    return {
      jobId: input.job.id,
      artifacts,
      flowUrl: this.page.url()
    };
  }

  // Result media currently on the page (authenticated media URLs, or data: in fixtures).
  // Video results render as <video> elements; image results as full (non-thumbnail) <img>.
  // Video posters/thumbnails carry mediaUrlType=...THUMBNAIL and must be excluded.
  private async resultSrcs(type: "image" | "video"): Promise<string[]> {
    if (type === "video") {
      return this.page.$$eval("video", (vids) =>
        vids
          .map((v) => (v as HTMLVideoElement).currentSrc || (v as HTMLVideoElement).src)
          .filter((src) => /media\.getMediaUrlRedirect/.test(src))
      );
    }
    return this.page.$$eval("img", (imgs) =>
      imgs
        .map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src)
        .filter((src) => (/media\.getMediaUrlRedirect/.test(src) && !/mediaUrlType=/.test(src)) || src.startsWith("data:"))
    );
  }

  // Enter a project so the prompt box exists. If the editor is already showing (real Flow
  // project or the test fixture), do nothing; otherwise open a fresh project from the dashboard.
  private async ensureProject(): Promise<void> {
    const locators = flowLocators(this.page);
    if ((await locators.promptBox.count()) > 0) return;
    const newProject = locators.newProjectButton.first();
    if (await newProject.count()) {
      await newProject.click().catch(() => undefined);
      await locators.promptBox.first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    }
  }

  // Best-effort: open the settings popover and set mode/model/ratio/duration/outputs. The
  // controls live in a portal and are driven by React, so each option must be picked with a
  // real (trusted) Playwright click — a DOM .click() in page.evaluate is ignored and leaves
  // the mode on Image. When the popover is absent (e.g. the fixture) we leave current settings.
  private async applySettings(job: GFlowJob): Promise<void> {
    const settings = flowLocators(this.page).settingsButton.first();
    if (!(await settings.count())) return;

    await settings.click({ force: true }).catch(() => undefined);
    await this.page.waitForTimeout(700);

    // Mode first — switching it changes which ratios/durations/models are offered.
    await this.pickOption(job.type === "video" ? /Video$/ : /Image$/);
    await this.page.waitForTimeout(400);

    // Video input mode: Frames (first/last frame images) vs Ingredients (text-to-video).
    if (job.type === "video") {
      const wantsFrames = Boolean(job.startFrame || job.endFrame);
      await this.pickOption(wantsFrames ? /Frames$/ : /Ingredients$/);
      await this.page.waitForTimeout(300);
    }

    if (job.ratio && RATIO_ICON[job.ratio]) await this.pickOption(new RegExp(`^${RATIO_ICON[job.ratio]}`));
    if (job.type === "video" && job.duration) await this.pickOption(new RegExp(`^${job.duration}s$`));
    await this.pickOption(job.outputs === 1 ? /^1x$/ : new RegExp(`^x${job.outputs}$`));
    if (job.model) await this.pickModel(job.model);

    await this.page.keyboard.press("Escape").catch(() => undefined);
    await this.page.waitForTimeout(300);
  }

  // Mark the visible control whose trimmed text matches `pattern`, then real-click it. The
  // marker lets us match on the icon-ligature text (e.g. "play_circleVideo", "crop_16_916:9",
  // "8s") yet still dispatch a trusted pointer event that React honors.
  private async pickOption(pattern: RegExp): Promise<boolean> {
    const marked = await this.page.evaluate(
      ({ source, flags }) => {
        const re = new RegExp(source, flags);
        const el = [...document.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .find((b) => re.test((b.textContent || "").trim()));
        if (!el) return false;
        el.setAttribute("data-gflow-pick", "1");
        return true;
      },
      { source: pattern.source, flags: pattern.flags }
    );
    if (!marked) return false;
    await this.page.locator('[data-gflow-pick="1"]').first().click().catch(() => undefined);
    await this.page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
    await this.page.waitForTimeout(250);
    return true;
  }

  // Open the model dropdown and pick the option whose name matches `model` (compared with
  // punctuation/spacing stripped, so "veo-3.1-fast" matches "Veo 3.1 - Fast").
  private async pickModel(model: string): Promise<void> {
    if (!(await this.pickOption(/arrow_drop_down/))) return;
    await this.page.waitForTimeout(700);
    const target = model.toLowerCase().replace(/[^a-z0-9]/g, "");
    const marked = await this.page.evaluate((t) => {
      const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const el = [...document.querySelectorAll("[role=option],[role=menuitem],[role=menuitemradio],button,li")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((e) => t.length > 2 && norm(e.textContent).includes(t));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    }, target);
    if (marked) {
      await this.page.locator('[data-gflow-pick="1"]').first().click().catch(() => undefined);
      await this.page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
    } else {
      await this.page.keyboard.press("Escape").catch(() => undefined);
    }
    await this.page.waitForTimeout(300);
  }

  // Frames mode: fill the Start/End frame slot. Clicking the slot opens the Add Media dialog;
  // "Upload media" triggers a file chooser; the upload is auto-selected, and the dialog's
  // confirm button ("Add to Prompt") assigns it to the slot and closes the dialog. A slot
  // already filled has no "Start"/"End" label, so we skip it rather than overwrite.
  private async uploadFrame(slot: "Start" | "End", filePath: string): Promise<void> {
    const slotEl = this.page.getByText(slot, { exact: true }).first();
    if ((await slotEl.count()) === 0) return;
    await slotEl.click().catch(() => undefined);

    const dialog = this.page.locator("[role=dialog],[aria-modal=true]").first();
    await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);

    const uploadButton = dialog.locator("button").filter({ hasText: /upload media/i }).first();
    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser", { timeout: 15000 }),
      uploadButton.click()
    ]);
    await chooser.setFiles(filePath);

    // The freshly uploaded image is auto-selected; wait for that, falling back to selecting
    // the first tile if needed, then confirm.
    const selected = dialog.locator('[role=option][aria-selected="true"]').first();
    await selected.waitFor({ state: "visible", timeout: 30000 }).catch(async () => {
      await dialog.locator("[role=option]").first().click().catch(() => undefined);
    });

    const confirm = dialog.locator("button").filter({ hasText: /add to (prompt|scene)/i }).first();
    await confirm.click().catch(() => undefined);
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
  }

  private async fillPrompt(prompt: string): Promise<void> {
    const box = flowLocators(this.page).promptBox.first();
    await box.click();
    // Clear any existing text (sequential/batch jobs reuse the same prompt box) with real
    // key events, then type so the contenteditable's framework registers the input.
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(prompt, { delay: 8 });
  }

  private async submit(): Promise<void> {
    const submit = flowLocators(this.page).submitButton.first();
    await submit.waitFor({ state: "visible", timeout: 15000 });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const enabled = await submit.evaluate((b) => !((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true")).catch(() => false);
      if (enabled) break;
      await this.page.waitForTimeout(300);
    }
    await submit.click();
  }

  private async waitForResults(before: Set<string>, expected: number, timeoutMs: number, type: "image" | "video"): Promise<string[]> {
    const locators = flowLocators(this.page);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await locators.rateLimitMarker.first().isVisible().catch(() => false)) {
        throw new RateLimitedError("Flow displayed a rate limit or unusual activity message.");
      }
      if (await locators.creditMarker.first().isVisible().catch(() => false)) {
        throw new CreditLimitError("Flow displayed a credit or quota message.");
      }
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationBlockedError("Flow displayed a policy block message.");
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError("Flow displayed a generation failed message.");
      }

      const added = (await this.resultSrcs(type)).filter((src) => !before.has(src));
      if (added.length >= expected) return added.slice(0, expected);
      await this.page.waitForTimeout(1500);
    }

    const added = (await this.resultSrcs(type)).filter((src) => !before.has(src));
    if (added.length > 0) return added;
    throw new GenerationFailedError(`Timed out waiting for ${expected} result(s).`);
  }
}
