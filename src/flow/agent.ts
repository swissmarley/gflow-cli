import { join } from "node:path";
import type { Page } from "playwright";
import { GenerationBlockedError, GenerationFailedError } from "../errors.js";
import { artifactBasename, writeArtifactMetadata } from "../output/artifacts.js";
import { downloadResult } from "./download.js";
import { flowLocators } from "./locators.js";
import type {
  AgentAutomation, AgentInstructionInput, AgentInstructionSummary,
  AgentSettingsInput, FlowJobResult, RunAgentInput
} from "./types.js";
import { addFromProject, navigateToProject, pickOption, pickOptionInSection, projectSubUrl, selectModelOption } from "./ui.js";

const RATIO_ICON: Record<string, string> = {
  "16:9": "crop_16_9", "9:16": "crop_9_16", "4:3": "crop_landscape", "1:1": "crop_square", "3:4": "crop_portrait"
};

export class AgentPage implements AgentAutomation {
  constructor(private readonly page: Page) {}

  private async openAgent(project?: string): Promise<void> {
    const projectId = await navigateToProject(this.page, project);
    await this.page.goto(projectSubUrl(projectId, ""), { waitUntil: "domcontentloaded" });
    await this.page.locator('[role="textbox"][contenteditable="true"]').first().waitFor({ state: "visible", timeout: 20000 });
    // Toggle Agent on if it isn't already (the bar shows "Agent Instructions" when active).
    const active = await this.page.getByText(/Agent Instructions/i).first().isVisible().catch(() => false);
    if (!active) await pickOption(this.page, /^Agent$/);
    await this.page.waitForTimeout(400);
  }

  async applySettings(input: AgentSettingsInput): Promise<void> {
    await this.openAgent(input.project);
    await pickOption(this.page, /tuneSettings/);
    await this.page.waitForTimeout(600);

    if (input.confirm) await pickOption(this.page, input.confirm === "always" ? /Always/ : /Never/);
    const img = /Image generation default/i;
    if (input.imageRatio && RATIO_ICON[input.imageRatio]) await pickOptionInSection(this.page, img, new RegExp(`^${RATIO_ICON[input.imageRatio]}`));
    if (input.imageQuantity) await pickOptionInSection(this.page, img, input.imageQuantity === 1 ? /^1x$/ : new RegExp(`^x${input.imageQuantity}$`));
    if (input.imageModel) await this.pickSectionModel(img, input.imageModel);
    const vid = /Video generation default/i;
    if (input.videoRatio && RATIO_ICON[input.videoRatio]) await pickOptionInSection(this.page, vid, new RegExp(`^${RATIO_ICON[input.videoRatio]}`));
    if (input.videoQuantity) await pickOptionInSection(this.page, vid, input.videoQuantity === 1 ? /^1x$/ : new RegExp(`^x${input.videoQuantity}$`));
    if (input.videoModel) await this.pickSectionModel(vid, input.videoModel);

    await pickOption(this.page, /^Save$/);
    await this.page.waitForTimeout(500);
  }

  // Open the model dropdown within a section, then choose the model from the open menu.
  private async pickSectionModel(section: RegExp, model: string): Promise<void> {
    await pickOptionInSection(this.page, section, /arrow_drop_down/);
    await this.page.waitForTimeout(500);
    await selectModelOption(this.page, model);
  }

  async addInstruction(input: AgentInstructionInput): Promise<void> {
    await this.openAgent(input.project);
    await pickOption(this.page, /article_sparkAgent Instructions/);
    await this.page.waitForTimeout(400);
    await pickOption(this.page, /Add instruction/);
    await this.page.waitForTimeout(400);
    if (input.ref) await addFromProject(this.page, /Add Image|Reference/i, input.ref);
    // The guideline field is the editable element near the "Create a guideline..." placeholder.
    const field = this.page.locator('[role="textbox"][contenteditable="true"]').last();
    await field.click().catch(() => undefined);
    await field.pressSequentially(input.text, { delay: 8 }).catch(() => undefined);
    await pickOption(this.page, /^Done$/);
    await this.page.waitForTimeout(300);
  }

  async listInstructions(project?: string): Promise<AgentInstructionSummary[]> {
    await this.openAgent(project);
    await pickOption(this.page, /article_sparkAgent Instructions/);
    await this.page.waitForTimeout(400);
    // VERIFY LIVE: instruction-row text/ref structure.
    return this.page.evaluate(() =>
      [...document.querySelectorAll('[role=textbox][contenteditable=true]')]
        .map((e) => (e.textContent ?? "").trim())
        .filter((t) => t.length > 0 && !/What do you want to create/i.test(t))
        .map((text) => ({ text, hasRef: false }))
    );
  }

  async clearInstructions(project?: string): Promise<void> {
    await this.openAgent(project);
    await pickOption(this.page, /article_sparkAgent Instructions/);
    await this.page.waitForTimeout(400);
    for (let i = 0; i < 20; i += 1) {
      const removed = await pickOption(this.page, /Remove instruction/);
      if (!removed) break;
      await this.page.waitForTimeout(200);
    }
    await pickOption(this.page, /^Done$/);
  }

  async runAgent(input: RunAgentInput): Promise<FlowJobResult> {
    await this.openAgent(input.project);
    const locators = flowLocators(this.page);
    const box = this.page.locator('[role="textbox"][contenteditable="true"]').first();
    await box.click();
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(input.prompt, { delay: 8 });

    const before = new Set(await this.resultSrcs());
    await this.page.locator("button").filter({ hasText: "Create" }).filter({ hasText: /arrow_forward/ }).first().click();

    const deadline = Date.now() + (input.timeout ?? 1800) * 1000;
    let newSrcs: string[] = [];
    while (Date.now() < deadline) {
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) throw new GenerationBlockedError("Agent generation was blocked.");
      if (await locators.failedMarker.first().isVisible().catch(() => false)) throw new GenerationFailedError("Agent generation failed.");
      newSrcs = (await this.resultSrcs()).filter((s) => !before.has(s));
      if (newSrcs.length > 0) break;
      await this.page.waitForTimeout(2000);
    }
    if (newSrcs.length === 0) throw new GenerationFailedError("Agent produced no downloadable results in time.");

    const context = this.page.context();
    const artifacts: { path: string; metadataPath: string }[] = [];
    for (let index = 0; index < newSrcs.length; index += 1) {
      const basename = artifactBasename(input.id, index + 1);
      const type: "image" | "video" = /\.mp4|video/i.test(newSrcs[index]) ? "video" : "image";
      const { assetPath } = await downloadResult({ page: this.page, context, src: newSrcs[index], type, quality: "original", outDir: input.outDir, basename });
      const metadataPath = join(input.outDir, `${basename}.json`);
      await writeArtifactMetadata(metadataPath, {
        jobId: input.id, type, prompt: input.prompt, requestedOutputs: newSrcs.length, quality: "original",
        downloadedAt: new Date().toISOString(), source: "google-flow-browser", flowUrl: this.page.url(), status: "downloaded"
      });
      artifacts.push({ path: assetPath, metadataPath });
    }
    return { jobId: input.id, artifacts, flowUrl: this.page.url() };
  }

  private async resultSrcs(): Promise<string[]> {
    return this.page.evaluate(() => {
      const out: string[] = [];
      for (const v of [...document.querySelectorAll("video")]) {
        const s = (v as HTMLVideoElement).currentSrc || (v as HTMLVideoElement).src;
        if (/media\.getMediaUrlRedirect/.test(s)) out.push(s);
      }
      for (const i of [...document.querySelectorAll("img")]) {
        const s = (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src;
        if (/media\.getMediaUrlRedirect/.test(s) && !/mediaUrlType=/.test(s)) out.push(s);
      }
      return out;
    });
  }
}
