import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createArtifactPlan, writeArtifactMetadata } from "../src/output/artifacts.js";

describe("artifact output", () => {
  it("creates deterministic asset and metadata paths", () => {
    const plan = createArtifactPlan({
      outDir: "/tmp/out",
      jobId: "hero-video",
      index: 1,
      extension: ".mp4"
    });

    expect(plan.assetPath).toBe("/tmp/out/hero-video/hero-video-001.mp4");
    expect(plan.metadataPath).toBe("/tmp/out/hero-video/hero-video-001.json");
  });

  it("writes metadata json beside the asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "gflow-test-"));
    const plan = createArtifactPlan({
      outDir: root,
      jobId: "concept-image",
      index: 2,
      extension: "png"
    });

    await writeArtifactMetadata(plan.metadataPath, {
      jobId: "concept-image",
      type: "image",
      prompt: "Prompt",
      project: "Project",
      model: "model",
      ratio: "1:1",
      duration: undefined,
      requestedOutputs: 4,
      downloadedAt: "2026-06-02T00:00:00.000Z",
      source: "google-flow-browser",
      flowUrl: "https://labs.google/fx/tools/flow",
      status: "downloaded"
    });

    const metadata = JSON.parse(await readFile(plan.metadataPath, "utf8"));
    expect(metadata.jobId).toBe("concept-image");
    expect(metadata.status).toBe("downloaded");
  });
});
