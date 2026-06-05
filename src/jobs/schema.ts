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
