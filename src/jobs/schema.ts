import YAML from "yaml";
import { z } from "zod";

const baseJobSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/),
  project: z.string().min(1).optional(),
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  ratio: z.string().min(1).optional(),
  outputs: z.number().int().min(1).max(8).default(1),
  out: z.string().min(1).default("./gflow-output"),
  timeout: z.number().int().min(1).optional(),
  ingredients: z.array(z.string().min(1)).default([]),
  character: z.array(z.string().min(1)).default([]),
  upscale: z.enum(["2k", "4k"]).optional()
});

export const imageJobSchema = baseJobSchema.extend({
  type: z.literal("image")
});

export const videoJobSchema = baseJobSchema.extend({
  type: z.literal("video"),
  duration: z.number().int().min(1).max(30).optional(),
  startFrame: z.string().min(1).optional(),
  endFrame: z.string().min(1).optional()
});

export const jobSchema = z.discriminatedUnion("type", [imageJobSchema, videoJobSchema]);

export const UPSCALE_TIERS = ["2k", "4k"] as const;

export const batchSchema = z.object({
  jobs: z.array(jobSchema).min(1)
});

export type ImageJob = z.infer<typeof imageJobSchema>;
export type VideoJob = z.infer<typeof videoJobSchema>;
export type GFlowJob = z.infer<typeof jobSchema>;
export type BatchFile = z.infer<typeof batchSchema>;

export function parseImageJob(value: unknown): ImageJob {
  return imageJobSchema.parse(value);
}

export function parseVideoJob(value: unknown): VideoJob {
  return videoJobSchema.parse(value);
}

export function parseJob(value: unknown): GFlowJob {
  return jobSchema.parse(value);
}

export function parseBatch(value: unknown): BatchFile {
  const batch = batchSchema.parse(value);
  const seen = new Set<string>();

  for (const job of batch.jobs) {
    if (seen.has(job.id)) {
      throw new Error(`Duplicate job id: ${job.id}`);
    }
    seen.add(job.id);
  }

  return batch;
}

export function parseBatchYaml(text: string): BatchFile {
  return parseBatch(YAML.parse(text));
}

export const TOOL_PRESETS = ["image-filter", "style-morph", "time-stretcher", "voice-over"] as const;
export const toolSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1),
  preset: z.enum(TOOL_PRESETS).optional(),
  project: z.string().min(1).optional()
});
export type ToolSpec = z.infer<typeof toolSchema>;
export function parseTool(value: unknown): ToolSpec {
  return toolSchema.parse(value);
}

export const agentSettingsSchema = z.object({
  confirm: z.enum(["always", "never"]).optional(),
  imageModel: z.string().min(1).optional(),
  imageRatio: z.string().min(1).optional(),
  imageQuantity: z.number().int().min(1).max(4).optional(),
  videoModel: z.string().min(1).optional(),
  videoRatio: z.string().min(1).optional(),
  videoQuantity: z.number().int().min(1).max(4).optional(),
  project: z.string().min(1).optional()
});
export const agentInstructionSchema = z.object({
  text: z.string().min(1),
  ref: z.string().min(1).optional(),
  project: z.string().min(1).optional()
});
export const agentRunSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/),
  prompt: z.string().min(1),
  project: z.string().min(1).optional(),
  out: z.string().min(1).default("./gflow-output"),
  timeout: z.number().int().min(1).optional()
});
export type AgentSettingsSpec = z.infer<typeof agentSettingsSchema>;
export type AgentInstructionSpec = z.infer<typeof agentInstructionSchema>;
export type AgentRunSpec = z.infer<typeof agentRunSchema>;
export const parseAgentSettings = (v: unknown): AgentSettingsSpec => agentSettingsSchema.parse(v);
export const parseAgentInstruction = (v: unknown): AgentInstructionSpec => agentInstructionSchema.parse(v);
export const parseAgentRun = (v: unknown): AgentRunSpec => agentRunSchema.parse(v);

export const CHARACTER_MODELS = ["nano-banana-2", "nano-banana-pro"] as const;
export const CHARACTER_PRESETS = ["familiar", "eccentric", "wicked", "fantastical"] as const;

export const characterSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9._ -]+$/),
  prompt: z.string().min(1),
  description: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  model: z.enum(CHARACTER_MODELS).optional(),
  preset: z.enum(CHARACTER_PRESETS).optional(),
  images: z.array(z.string().min(1)).default([]),
  fromProject: z.array(z.string().min(1)).default([]),
  project: z.string().min(1).optional(),
  out: z.string().min(1).default("./gflow-output")
});
export type CharacterSpec = z.infer<typeof characterSchema>;
export function parseCharacter(value: unknown): CharacterSpec {
  return characterSchema.parse(value);
}

// Flow's scenebuilder extends in ~7-8s hops, at most 20 of them, up to a 148s scene
// (Veo extend limit), so more prompts than that can never succeed in one run.
export const MAX_SCENE_EXTENDS = 20;

export const extendSceneSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/).default("scene"),
    mediaId: z.string().min(1).optional(),
    scene: z.string().min(1).optional(),
    prompts: z.array(z.string().min(1)).max(MAX_SCENE_EXTENDS).default([]),
    addClips: z.array(z.string().min(1)).default([]),
    project: z.string().min(1).optional(),
    out: z.string().min(1).default("./gflow-output"),
    timeout: z.number().int().min(1).optional(),
    download: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (!value.mediaId && !value.scene) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "provide --media-id to start a scene from a video, or --scene to continue an existing scene" });
    }
    if (value.mediaId && value.scene) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "--media-id and --scene are mutually exclusive" });
    }
    if (value.prompts.length === 0 && value.addClips.length === 0 && !value.download) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nothing to do: no --prompt, no --add-clip, and download disabled" });
    }
  });
export type ExtendSceneSpec = z.infer<typeof extendSceneSchema>;
export function parseExtendScene(value: unknown): ExtendSceneSpec {
  return extendSceneSchema.parse(value);
}

export const editMediaSchema = z.object({
  mediaId: z.string().min(1),
  prompt: z.string().min(1),
  referenceImages: z.array(z.string().min(1)).default([]),
  fromProject: z.array(z.string().min(1)).default([]),
  project: z.string().min(1).optional(),
  out: z.string().min(1).default("./gflow-output"),
  timeout: z.number().int().min(1).optional()
});
export type EditMediaSpec = z.infer<typeof editMediaSchema>;
export function parseEditMedia(value: unknown): EditMediaSpec {
  return editMediaSchema.parse(value);
}
