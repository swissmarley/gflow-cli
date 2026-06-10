import { describe, expect, it } from "vitest";
import { parseBatchYaml, parseImageJob, parseVideoJob, parseCharacter, parseTool } from "../src/jobs/schema.js";
import { parseAgentSettings, parseAgentInstruction, parseAgentRun } from "../src/jobs/schema.js";
import { parseExtendScene } from "../src/jobs/schema.js";

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

describe("character schema", () => {
  it("requires a name and prompt, defaults arrays", () => {
    const c = parseCharacter({ name: "Ranger", prompt: "a stoic ranger" });
    expect(c.name).toBe("Ranger");
    expect(c.images).toEqual([]);
    expect(c.fromProject).toEqual([]);
  });
  it("accepts model + preset + refs + description + voice", () => {
    const c = parseCharacter({ name: "Hero", prompt: "x", model: "nano-banana-pro", preset: "wicked", description: "brave warrior", voice: "Alto", images: ["/a.png"], fromProject: ["Hero"] });
    expect(c.model).toBe("nano-banana-pro");
    expect(c.preset).toBe("wicked");
    expect(c.description).toBe("brave warrior");
    expect(c.voice).toBe("Alto");
  });
  it("rejects an unknown model", () => {
    expect(() => parseCharacter({ name: "X", prompt: "x", model: "dall-e" })).toThrow();
  });
  it("rejects missing name", () => {
    expect(() => parseCharacter({ prompt: "x" })).toThrow();
  });
});

describe("tool schema", () => {
  it("requires a prompt", () => {
    expect(() => parseTool({})).toThrow();
  });
  it("accepts a preset", () => {
    expect(parseTool({ prompt: "remove background", preset: "image-filter" }).preset).toBe("image-filter");
  });
  it("rejects an unknown preset", () => {
    expect(() => parseTool({ prompt: "x", preset: "nope" })).toThrow();
  });
});

describe("extend scene schema", () => {
  it("parses media-id with ordered prompts and defaults", () => {
    const spec = parseExtendScene({ mediaId: "abc-123", prompts: ["wave crashes", "sun sets"] });
    expect(spec.id).toBe("scene");
    expect(spec.prompts).toEqual(["wave crashes", "sun sets"]);
    expect(spec.download).toBe(true);
    expect(spec.out).toBe("./gflow-output");
  });
  it("accepts a scene id with add-clips only", () => {
    const spec = parseExtendScene({ scene: "scene-1", addClips: ["9b14ed49"] });
    expect(spec.addClips).toEqual(["9b14ed49"]);
  });
  it("requires media-id or scene", () => {
    expect(() => parseExtendScene({ prompts: ["next"] })).toThrow();
  });
  it("rejects media-id and scene together", () => {
    expect(() => parseExtendScene({ mediaId: "a", scene: "b", prompts: ["next"] })).toThrow();
  });
  it("rejects more prompts than Flow's 20-extend cap", () => {
    expect(() => parseExtendScene({ mediaId: "a", prompts: Array.from({ length: 21 }, () => "next") })).toThrow();
  });
  it("rejects a run with nothing to do", () => {
    expect(() => parseExtendScene({ mediaId: "a", download: false })).toThrow();
  });
  it("allows a download-only export of an existing scene", () => {
    expect(parseExtendScene({ scene: "s1" }).download).toBe(true);
  });
});

describe("agent schemas", () => {
  it("agent settings accepts confirm + per-type defaults", () => {
    const s = parseAgentSettings({ confirm: "never", imageQuantity: 2, videoRatio: "9:16" });
    expect(s.confirm).toBe("never");
    expect(s.imageQuantity).toBe(2);
  });
  it("agent settings rejects quantity > 4", () => {
    expect(() => parseAgentSettings({ imageQuantity: 5 })).toThrow();
  });
  it("instruction requires text", () => {
    expect(() => parseAgentInstruction({ ref: "Hero" })).toThrow();
    expect(parseAgentInstruction({ text: "keep it cinematic" }).text).toBe("keep it cinematic");
  });
  it("agent run requires id + prompt", () => {
    expect(parseAgentRun({ id: "a1", prompt: "make a teaser" }).out).toBe("./gflow-output");
  });
});
