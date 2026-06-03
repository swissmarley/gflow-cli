import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { FlowPage } from "../src/flow/page.js";

describe("FlowPage fixture", () => {
  it("fills a job and downloads generated output from the fixture", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-output-"));
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      acceptDownloads: true
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const fixtureAsset = join(outDir, "fixture.png");
      await writeFile(fixtureAsset, "fixture asset", "utf8");
      await page.goto(`file://${process.cwd()}/fixtures/flow/index.html?fixtureAsset=${encodeURIComponent(fixtureAsset)}`);

      const flow = new FlowPage(page);
      const result = await flow.runJob({
        job: {
          id: "concept-image",
          type: "image",
          prompt: "A studio product still",
          outputs: 1,
          out: outDir,
          ingredients: []
        },
        outDir
      });

      expect(result.jobId).toBe("concept-image");
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]?.path).toContain("concept-image-001.png");
    } finally {
      await context.close();
    }
  });
});
