import { describe, expect, it } from "vitest";
import { parseBatchYaml, parseImageJob, parseVideoJob } from "../src/jobs/schema.js";

describe("job schemas", () => {
  it("parses an image job with defaults", () => {
    const job = parseImageJob({
      id: "concept-image",
      type: "image",
      prompt: "A studio product still"
    });

    expect(job).toMatchObject({
      id: "concept-image",
      type: "image",
      prompt: "A studio product still",
      outputs: 1,
      out: "./gflow-output"
    });
  });

  it("parses a video job with duration and ratio", () => {
    const job = parseVideoJob({
      id: "hero-video",
      type: "video",
      prompt: "A cinematic product reveal",
      duration: 8,
      ratio: "16:9"
    });

    expect(job.duration).toBe(8);
    expect(job.ratio).toBe("16:9");
  });

  it("rejects a batch with duplicate ids", () => {
    expect(() =>
      parseBatchYaml(`
jobs:
  - id: dup
    type: image
    prompt: One
  - id: dup
    type: video
    prompt: Two
`)
    ).toThrow("Duplicate job id");
  });
});

describe("image/video upscale + character", () => {
  it("defaults character to [] and leaves upscale undefined", () => {
    const job = parseImageJob({ id: "a", type: "image", prompt: "x" });
    expect(job.character).toEqual([]);
    expect(job.upscale).toBeUndefined();
  });
  it("accepts upscale 2k and character names", () => {
    const job = parseVideoJob({ id: "b", type: "video", prompt: "x", upscale: "2k", character: ["Nyra"] });
    expect(job.upscale).toBe("2k");
    expect(job.character).toEqual(["Nyra"]);
  });
  it("rejects an invalid upscale value", () => {
    expect(() => parseImageJob({ id: "c", type: "image", prompt: "x", upscale: "8k" })).toThrow();
  });
});
