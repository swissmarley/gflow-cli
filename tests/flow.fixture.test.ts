import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("waits for fresh outputs instead of reusing stale download links", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-output-"));
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      acceptDownloads: true
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`file://${process.cwd()}/fixtures/flow/index.html?delay=100`);

      const flow = new FlowPage(page);
      const first = await flow.runJob({
        job: {
          id: "first-image",
          type: "image",
          prompt: "First image",
          outputs: 1,
          out: outDir,
          ingredients: []
        },
        outDir
      });
      const second = await flow.runJob({
        job: {
          id: "second-image",
          type: "image",
          prompt: "Second image",
          outputs: 1,
          out: outDir,
          ingredients: []
        },
        outDir
      });

      expect(first.artifacts[0]?.path).toContain("first-image-001.png");
      expect(second.artifacts[0]?.path).toContain("second-image-001.png");
      await expect(readFile(first.artifacts[0]!.path, "utf8")).resolves.toBe("fixture generation 1");
      await expect(readFile(second.artifacts[0]!.path, "utf8")).resolves.toBe("fixture generation 2");
      expect(await page.getByRole("link", { name: /download/i }).count()).toBe(2);
    } finally {
      await context.close();
    }
  });
});
