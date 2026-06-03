import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../src/errors.js";
import type { FlowAutomation } from "../src/flow/types.js";
import { runJobs } from "../src/jobs/runner.js";
import type { GFlowJob } from "../src/jobs/schema.js";

function job(id: string): GFlowJob {
  return {
    id,
    type: "image",
    prompt: `Prompt ${id}`,
    outputs: 1,
    out: "./gflow-output",
    ingredients: []
  };
}

describe("runJobs", () => {
  it("runs jobs serially and writes run status", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "gflow-run-"));
    const calls: string[] = [];
    const automation: FlowAutomation = {
      async runJob(input) {
        calls.push(input.job.id);
        return {
          jobId: input.job.id,
          artifacts: [],
          flowUrl: "https://labs.google/fx/tools/flow"
        };
      }
    };

    const result = await runJobs({
      jobs: [job("one"), job("two")],
      outDir,
      continueOnFailure: false,
      automation
    });

    expect(calls).toEqual(["one", "two"]);
    expect(result.status).toBe("completed");
    const status = JSON.parse(await readFile(join(outDir, "gflow-run.json"), "utf8"));
    expect(status.jobs[0].status).toBe("completed");
  });

  it("stops on rate limiting even when continueOnFailure is true", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "gflow-run-"));
    const automation: FlowAutomation = {
      async runJob() {
        throw new RateLimitedError("Too many requests");
      }
    };

    await expect(
      runJobs({
        jobs: [job("one"), job("two")],
        outDir,
        continueOnFailure: true,
        automation
      })
    ).rejects.toThrow("rate limiting");
  });
});
