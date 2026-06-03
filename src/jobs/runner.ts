import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CreditLimitError,
  GenerationBlockedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError,
  messageForError
} from "../errors.js";
import type { FlowAutomation, FlowJobResult } from "../flow/types.js";
import type { GFlowJob } from "./schema.js";

type JobStatus = "pending" | "running" | "completed" | "failed";
type RunStatus = "completed" | "failed";

interface RunJobRecord {
  id: string;
  type: GFlowJob["type"];
  status: JobStatus;
  error?: string;
  artifacts: string[];
}

export interface RunJobsInput {
  jobs: GFlowJob[];
  outDir: string;
  continueOnFailure: boolean;
  automation: FlowAutomation;
}

export interface RunJobsResult {
  status: RunStatus;
  results: FlowJobResult[];
}

function isHardStop(error: unknown): boolean {
  return (
    error instanceof LoginRequiredError ||
    error instanceof ManualActionRequiredError ||
    error instanceof UiContractError ||
    error instanceof GenerationBlockedError ||
    error instanceof RateLimitedError ||
    error instanceof CreditLimitError
  );
}

async function writeRunState(outDir: string, jobs: RunJobRecord[]): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "gflow-run.json"),
    `${JSON.stringify({ source: "google-flow-browser", jobs }, null, 2)}\n`,
    "utf8"
  );
}

export async function runJobs(input: RunJobsInput): Promise<RunJobsResult> {
  const records: RunJobRecord[] = input.jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: "pending",
    artifacts: []
  }));
  const results: FlowJobResult[] = [];

  await writeRunState(input.outDir, records);

  for (const [index, job] of input.jobs.entries()) {
    records[index].status = "running";
    await writeRunState(input.outDir, records);

    try {
      const result = await input.automation.runJob({ job, outDir: input.outDir });
      records[index].status = "completed";
      records[index].artifacts = result.artifacts.map((artifact) => artifact.path);
      results.push(result);
      await writeRunState(input.outDir, records);
    } catch (error) {
      records[index].status = "failed";
      records[index].error = messageForError(error);
      await writeRunState(input.outDir, records);

      if (isHardStop(error) || !input.continueOnFailure) {
        throw error;
      }
    }
  }

  return {
    status: records.some((record) => record.status === "failed") ? "failed" : "completed",
    results
  };
}
