import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { FlowPage } from "../src/flow/page.js";

const FIXTURE = `file://${process.cwd()}/fixtures/flow/index.html`;

describe("FlowPage fixture", () => {
  it("types a prompt, submits, and downloads the generated result", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-output-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(FIXTURE);

      const flow = new FlowPage(page);
      const result = await flow.runJob({
        job: { id: "concept-image", type: "image", prompt: "A studio product still", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });

      expect(result.jobId).toBe("concept-image");
      expect(result.artifacts).toHaveLength(1);
      const saved = result.artifacts[0]!.path;
      expect(saved).toContain("concept-image-001.png");
      // Downloaded through the viewer's Download menu (Original tier); the fixture encodes
      // the result identity in the bytes so we verify the right result reached disk.
      await expect(readFile(saved, "utf8")).resolves.toBe("fixture-gen-1:original");
    } finally {
      await context.close();
    }
  });

  it("detects fresh results per run instead of reusing earlier ones", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-output-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${FIXTURE}?delay=100`);

      const flow = new FlowPage(page);
      const first = await flow.runJob({
        job: { id: "first-image", type: "image", prompt: "First image", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });
      const second = await flow.runJob({
        job: { id: "second-image", type: "image", prompt: "Second image", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });

      expect(first.artifacts[0]?.path).toContain("first-image-001.png");
      expect(second.artifacts[0]?.path).toContain("second-image-001.png");
      await expect(readFile(first.artifacts[0]!.path, "utf8")).resolves.toBe("fixture-gen-1:original");
      await expect(readFile(second.artifacts[0]!.path, "utf8")).resolves.toBe("fixture-gen-2:original");
    } finally {
      await context.close();
    }
  });

  it("downloads a video through the viewer's menu-less Download button", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "gflow-profile-"));
    const outDir = await mkdtemp(join(tmpdir(), "gflow-output-"));
    const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // ?type=video makes the fixture render a <video> result whose viewer has a plain
      // Download button (no tier menu), like real Flow — exercising the direct-download path.
      await page.goto(`${FIXTURE}?type=video`);

      const flow = new FlowPage(page);
      const result = await flow.runJob({
        job: { id: "clip", type: "video", prompt: "A short clip", outputs: 1, out: outDir, ingredients: [], character: [] },
        outDir
      });

      const saved = result.artifacts[0]!.path;
      expect(saved).toContain("clip-001.mp4");
      await expect(readFile(saved, "utf8")).resolves.toBe("fixture-gen-1:original");
    } finally {
      await context.close();
    }
  });
});
