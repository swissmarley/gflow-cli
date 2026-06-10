import { extname, join } from "node:path";
import type { Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  RateLimitedError
} from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { flowLocators } from "./locators.js";
import type { ExtendSceneInput, ExtendSceneResult, SceneAutomation, SceneSummary } from "./types.js";
import { FLOW_BASE, dismissOpenLayers, resolveExistingProject } from "./ui.js";

// All selectors below were verified against the live scenebuilder UI:
// - A video card on the project page links to /project/<id>/edit/<tileId>; opening it
//   seeds a NEW scene timeline with that clip. Once the first extend/add-clip lands,
//   the URL morphs to /project/<id>/scene/<sceneId>, which is the only way to resume
//   that timeline later (re-opening the /edit/ link starts a fresh scene).
// - The timeline "+" button is `button[aria-haspopup=menu][data-add-button=true]`
//   ("add Add Clip"). Its Radix menu offers "Add Clip" and "Extend (<model>)".
// - While that menu is open the page intercepts every pointer event outside the menu
//   portal, so only the menu items themselves are clickable — clicking anything else
//   stalls until the action timeout. Menu items must be clicked inside the portal.
// - Extend mode swaps the prompt box placeholder to "What happens next?" and shows an
//   "Extend (…) close" chip; submit is the arrow_forward Create button.
// - Add Clip opens a media-browser panel (NOT role=dialog) with [role=option] tiles;
//   a single trusted click on a tile appends it and closes the panel by itself.
// - The player shows MM:SS:FF times (8s -> "00:08:00"); the largest such value is the
//   scene's total length, and its growth is the reliable "step finished" signal.
// - The scene Download button is a plain direct-download button (no tier menu).

export function sceneIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/scene\/([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

export class ScenePage implements SceneAutomation {
  constructor(private readonly page: Page) {}

  async listScenes(project?: string): Promise<SceneSummary[]> {
    const projectId = await resolveExistingProject(this.page, project);
    await this.page.goto(`${FLOW_BASE}/project/${projectId}`, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1500);

    return this.page.evaluate(() => {
      const results: Array<{ id: string; name?: string }> = [];
      const seen = new Set<string>();
      for (const a of [...document.querySelectorAll('a[href*="/scene/"]')]) {
        const match = (a.getAttribute("href") || "").match(/\/scene\/([0-9a-f-]+)/i);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        // The title is the first non-icon leaf inside the scene card. Icon ligatures
        // ("movie"/"play_circle"/"add") render as <i> with material-icons[-outlined] or
        // google-symbols classes, so exclude those rather than rely on one class name.
        const card = a.closest("[data-tile-id]") ?? a.parentElement ?? a;
        const leaf = [...card.querySelectorAll("*")].find(
          (e) =>
            e.children.length === 0 &&
            e.tagName !== "I" &&
            !/material-icons|google-symbols/.test(String(e.className || "")) &&
            (e.textContent || "").trim().length > 0
        );
        results.push({ id: match[1], name: leaf?.textContent?.trim() });
      }
      return results;
    });
  }

  async extendScene(input: ExtendSceneInput): Promise<ExtendSceneResult> {
    await this.openScene(input);

    const perStepTimeoutMs = (input.timeout ?? 600) * 1000;
    for (const prompt of input.prompts) {
      await this.extendOnce(prompt, perStepTimeoutMs);
    }
    for (const ref of input.addClips) {
      await this.addClipOnce(ref);
    }

    const totalDuration = await this.totalDurationLabel();
    const artifacts = input.download ? [await this.downloadScene(input, totalDuration)] : [];

    return {
      sceneId: sceneIdFromUrl(this.page.url()),
      totalDuration,
      artifacts,
      flowUrl: this.page.url()
    };
  }

  private async openScene(input: ExtendSceneInput): Promise<void> {
    const projectId = await resolveExistingProject(this.page, input.project);

    if (input.scene) {
      await this.page.goto(`${FLOW_BASE}/project/${projectId}/scene/${input.scene}`, { waitUntil: "domcontentloaded" });
    } else {
      await this.page.goto(`${FLOW_BASE}/project/${projectId}`, { waitUntil: "domcontentloaded" });
      await this.page.waitForTimeout(1500);
      const href = await this.page.evaluate((id) => {
        for (const a of [...document.querySelectorAll('a[href*="/edit/"]')]) {
          const media = [...a.querySelectorAll("video,img")] as Array<HTMLVideoElement | HTMLImageElement>;
          if (media.some((m) => (((m as HTMLVideoElement).currentSrc || m.src) || "").includes(id))) {
            return a.getAttribute("href");
          }
        }
        return null;
      }, input.mediaId ?? "");
      if (!href) {
        throw new GenerationFailedError(
          `Video "${input.mediaId}" not found in the project. Use \`gflow media list\` to find video ids.`
        );
      }
      await this.page.goto(new URL(href, FLOW_BASE).toString(), { waitUntil: "domcontentloaded" });
    }

    // Scenebuilder is ready once the timeline "+" button renders.
    await this.plusButton().waitFor({ state: "visible", timeout: 20000 }).catch(() => {
      throw new GenerationFailedError(
        input.scene
          ? `Scene "${input.scene}" did not open. Use \`gflow scene list\` to find scene ids.`
          : "The Flow scenebuilder did not load for that video."
      );
    });
    await this.page.waitForTimeout(500);
  }

  private plusButton() {
    // data-add-button is the stable hook; the text filter is the fallback if it ever drops.
    return this.page
      .locator('button[aria-haspopup="menu"][data-add-button="true"]')
      .or(this.page.locator('button[aria-haspopup="menu"]').filter({ hasText: /add\s*clip/i }))
      .first();
  }

  // Open the "+" menu and trusted-click the item matching `pattern` inside the Radix
  // portal. Returns false when the item is not offered (e.g. Extend past the scene cap).
  private async pickPlusMenuItem(pattern: RegExp): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await dismissOpenLayers(this.page);
      const plus = this.plusButton();
      await plus.click({ timeout: 3000 }).catch(async () => {
        await dismissOpenLayers(this.page);
        await plus.click({ timeout: 5000 });
      });

      const menu = this.page.locator('[data-radix-menu-content][data-state="open"], [role="menu"]').first();
      const open = await menu.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
      if (!open) continue;

      const marked = await this.page.evaluate(
        ({ source, flags }) => {
          const re = new RegExp(source, flags);
          const root =
            document.querySelector('[data-radix-menu-content][data-state="open"]') ?? document.querySelector('[role="menu"]');
          if (!root) return false;
          const el = [...root.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[data-radix-collection-item]')]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .find((e) => re.test((e.textContent || "").trim()));
          if (!el) return false;
          el.setAttribute("data-gflow-pick", "1");
          return true;
        },
        { source: pattern.source, flags: pattern.flags }
      );
      if (!marked) {
        // The menu is open but the item is missing — close it so nothing swallows clicks.
        await this.page.keyboard.press("Escape").catch(() => undefined);
        return false;
      }

      const clicked = await this.page
        .locator('[data-gflow-pick="1"]')
        .first()
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await this.page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
      if (clicked) return true;
      await dismissOpenLayers(this.page);
    }
    throw new GenerationFailedError("Could not open the scenebuilder \"+\" menu.");
  }

  private async extendOnce(prompt: string, timeoutMs: number): Promise<void> {
    const before = await this.totalDurationValue();

    if (!(await this.pickPlusMenuItem(/extend/i))) {
      throw new GenerationFailedError(
        "Flow did not offer Extend for this scene. Scenes are capped at 148 seconds (about 20 extends of ~7s each)."
      );
    }

    // Extend mode is on: the prompt box placeholder becomes "What happens next?".
    const box = this.page.locator('[role="textbox"][contenteditable="true"]').first();
    await box.waitFor({ state: "visible", timeout: 10000 });
    await box.click({ timeout: 2000 }).catch(async () => {
      await dismissOpenLayers(this.page);
      await box.click({ timeout: 5000 }).catch(() => box.evaluate((el) => (el as HTMLElement).focus()));
    });
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(prompt, { delay: 8 });

    const submit = this.page.locator("button").filter({ hasText: /arrow_forward/ }).first();
    const enabledDeadline = Date.now() + 15000;
    while (Date.now() < enabledDeadline) {
      const enabled = await submit
        .evaluate((b) => !((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true"))
        .catch(() => false);
      if (enabled) break;
      await this.page.waitForTimeout(300);
    }
    await submit.click({ timeout: 2000 }).catch(async () => {
      await dismissOpenLayers(this.page);
      await submit.click();
    });

    await this.waitForTimelineGrowth(before, timeoutMs, `extend "${prompt.slice(0, 40)}"`);
    await dismissOpenLayers(this.page);
  }

  private async addClipOnce(ref: string): Promise<void> {
    const before = await this.totalDurationValue();

    if (!(await this.pickPlusMenuItem(/add\s*clip/i))) {
      throw new GenerationFailedError("Flow did not offer Add Clip for this scene.");
    }

    // The clip picker is a panel (not role=dialog) of [role=option] tiles.
    await this.page
      .locator("[role=option]")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {
        throw new GenerationFailedError("The Add Clip picker did not open or has no assets.");
      });

    const marked = await this.page.evaluate((needle) => {
      const lower = needle.toLowerCase();
      const tiles = [...document.querySelectorAll("[role=option]")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const el = tiles.find((tile) => {
        const media = [...tile.querySelectorAll("video,img")] as Array<HTMLVideoElement | HTMLImageElement>;
        if (media.some((m) => ((((m as HTMLVideoElement).currentSrc || m.src) || "").toLowerCase()).includes(lower))) return true;
        return (tile.textContent || "").toLowerCase().includes(lower);
      });
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    }, ref);
    if (!marked) {
      await this.page.keyboard.press("Escape").catch(() => undefined);
      throw new GenerationFailedError(
        `Clip "${ref}" not found in the Add Clip picker. Pass a video media id (\`gflow media list\`) or its visible name.`
      );
    }

    // A single trusted click appends the clip and closes the picker on its own; if a
    // variant keeps the picker open behind a confirm button, press it as the fallback.
    await this.page.locator('[data-gflow-pick="1"]').first().click({ timeout: 5000 });
    await this.page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));

    const grew = await this.waitForTimelineGrowth(before, 8000, `add clip "${ref}"`, true);
    if (!grew) {
      const confirm = this.page.locator("button").filter({ hasText: /add to scene/i }).first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click({ timeout: 5000 }).catch(() => undefined);
      }
      await this.waitForTimelineGrowth(before, 60000, `add clip "${ref}"`);
    }
    await dismissOpenLayers(this.page);
  }

  // The largest MM:SS:FF readout on the page is the scene's total length.
  private async totalDurationLabel(): Promise<string> {
    const labels = await this.page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && /^\d{2}:\d{2}:\d{2}$/.test((e.textContent || "").trim()))
        .map((e) => (e.textContent || "").trim())
    );
    if (labels.length === 0) return "00:00:00";
    return labels.reduce((max, label) => (this.frames(label) > this.frames(max) ? label : max));
  }

  private frames(label: string): number {
    return label.split(":").reduce((total, part) => total * 60 + Number.parseInt(part, 10), 0);
  }

  private async totalDurationValue(): Promise<number> {
    return this.frames(await this.totalDurationLabel());
  }

  private async waitForTimelineGrowth(before: number, timeoutMs: number, step: string, soft = false): Promise<boolean> {
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
        throw new GenerationBlockedError(`Flow blocked the ${step} step.`);
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError(`Flow reported the ${step} step failed.`);
      }
      if ((await this.totalDurationValue()) > before) return true;
      await this.page.waitForTimeout(1500);
    }

    if (soft) return false;
    throw new GenerationFailedError(`Timed out waiting for the scene timeline to grow after ${step}.`);
  }

  // The scenebuilder Download button exports the full combined scene ("Exporting your
  // scene…" toast) and then downloads it directly (no quality menu). Right after an
  // extend the export can stall while Flow finishes rendering the new clip server-side,
  // so when no download arrives in time, click again — the retry reliably succeeds once
  // the clip is ready.
  private async downloadScene(input: ExtendSceneInput, totalDuration: string): Promise<{ path: string; metadataPath: string }> {
    const button = this.page.locator("button").filter({ hasText: /download/i }).first();
    let download;
    for (let attempt = 0; ; attempt += 1) {
      await dismissOpenLayers(this.page);
      await button.waitFor({ state: "visible", timeout: 10000 });
      try {
        [download] = await Promise.all([
          this.page.waitForEvent("download", { timeout: 300000 }),
          button.click({ timeout: 5000 }).catch(async () => {
            await dismissOpenLayers(this.page);
            await button.click();
          })
        ]);
        break;
      } catch (error) {
        if (attempt >= 1) {
          throw new GenerationFailedError("The scene export did not produce a download. Try again with `gflow extend --scene <id>` (download only).");
        }
        void error;
      }
    }

    const basename = artifactBasename(input.id, 1);
    const ext = extname(download.suggestedFilename()) || ".mp4";
    const assetPath = join(input.outDir, `${basename}${ext}`);
    await download.saveAs(assetPath);

    const parts = totalDuration.split(":").map((p) => Number.parseInt(p, 10));
    const metadataPath = join(input.outDir, `${basename}.json`);
    await writeArtifactMetadata(metadataPath, {
      jobId: input.id,
      type: "video",
      prompt: input.prompts.length > 0 ? input.prompts.join(" | ") : "(scene export)",
      project: input.project,
      duration: parts[0] * 60 + parts[1],
      requestedOutputs: 1,
      quality: "original",
      downloadedAt: new Date().toISOString(),
      source: "google-flow-browser",
      flowUrl: this.page.url(),
      status: "downloaded"
    });

    return { path: assetPath, metadataPath };
  }
}
