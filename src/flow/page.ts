import { mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { Locator, Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError
} from "../errors.js";
import { createArtifactPlan, writeArtifactMetadata } from "../output/artifacts.js";
import type { FlowAutomation, FlowAutomationRunInput, FlowJobResult } from "./types.js";
import { flowLocators } from "./locators.js";

export const FLOW_URL = "https://labs.google/fx/tools/flow";

async function fillOptional(locator: Locator, value: string | number | undefined): Promise<void> {
  if (value === undefined) return;
  if ((await locator.count()) === 0) return;
  await locator.fill(String(value));
}

export class FlowPage implements FlowAutomation {
  constructor(private readonly page: Page, private readonly flowUrl = FLOW_URL) {}

  async open(): Promise<void> {
    await this.page.goto(this.flowUrl);
  }

  async assertReady(): Promise<void> {
    const locators = flowLocators(this.page);
    if (await locators.manualActionMarker.first().isVisible().catch(() => false)) {
      throw new ManualActionRequiredError("Flow requires login, consent, or verification.");
    }
    if ((await locators.promptBox.count()) === 0) {
      throw new LoginRequiredError();
    }
  }

  async runJob(input: FlowAutomationRunInput): Promise<FlowJobResult> {
    const locators = flowLocators(this.page);
    await this.assertReady();

    if (input.job.type === "image") {
      await locators.imageModeButton.click();
    } else {
      await locators.videoModeButton.click();
    }

    await fillOptional(locators.projectInput, input.job.project);
    await fillOptional(locators.modelInput, input.job.model);
    await fillOptional(locators.ratioInput, input.job.ratio);
    await fillOptional(locators.outputCountInput, input.job.outputs);

    if (input.job.type === "video") {
      await fillOptional(locators.durationInput, input.job.duration);
    }

    if ((await locators.promptBox.count()) === 0) {
      throw new UiContractError("Prompt box is missing.");
    }

    const generationTimeoutSeconds = input.job.timeout ?? (input.job.type === "video" ? 1800 : 900);
    const initialDownloadCount = await locators.downloadLinks.count();
    await locators.promptBox.fill(input.job.prompt);
    await locators.generateButton.click();
    await this.waitForBlockingStates(initialDownloadCount + input.job.outputs, generationTimeoutSeconds * 1000);

    const artifacts = [];
    const availableDownloadCount = await locators.downloadLinks.count();
    const downloadCount = Math.min(input.job.outputs, availableDownloadCount - initialDownloadCount);

    if (downloadCount === 0) {
      throw new GenerationFailedError("No downloadable results appeared.");
    }

    for (let index = 0; index < downloadCount; index += 1) {
      const download = await Promise.all([this.page.waitForEvent("download"), locators.downloadLinks.nth(initialDownloadCount + index).click()]).then(
        ([downloadResult]) => downloadResult
      );
      const suggested = download.suggestedFilename();
      const extension = extname(suggested) || (input.job.type === "video" ? ".mp4" : ".png");
      const plan = createArtifactPlan({
        outDir: input.outDir,
        jobId: input.job.id,
        index: index + 1,
        extension
      });

      await mkdir(dirname(plan.assetPath), { recursive: true });
      await download.saveAs(plan.assetPath);
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

    return {
      jobId: input.job.id,
      artifacts,
      flowUrl: this.page.url()
    };
  }

  private async waitForBlockingStates(expectedDownloadCount: number, timeout: number): Promise<void> {
    const locators = flowLocators(this.page);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if ((await locators.downloadLinks.count()) >= expectedDownloadCount) return;
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
      await this.page.waitForTimeout(250);
    }

    throw new GenerationFailedError(`Timed out waiting for ${expectedDownloadCount} downloadable result(s).`);
  }
}
