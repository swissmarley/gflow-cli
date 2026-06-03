# Google Flow Browser CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `gflow`, a local TypeScript CLI that drives Google Flow through a visible Playwright browser session for image, video, and YAML batch generation.

**Architecture:** The CLI parses commands into validated job objects, then runs those jobs through a `FlowAutomation` interface. Unit tests exercise schema, output, CLI, and runner behavior with fakes; Playwright fixture tests exercise the browser automation contract without logging into Google.

**Tech Stack:** Node.js 20+, TypeScript, Commander, Zod, YAML, Playwright, Vitest, tsx, eslint.

---

## File Structure

- Create: `package.json` for package metadata, commands, and dependency scripts.
- Create: `tsconfig.json` for strict TypeScript compilation.
- Create: `eslint.config.js` for source linting.
- Create: `.gitignore` to keep generated outputs, browser profiles, and dependencies out of git.
- Create: `README.md` with install, login, generation, batch, and safety notes.
- Create: `examples/pipeline.yaml` with one image job and one video job.
- Create: `fixtures/flow/index.html` as a local Flow-like UI for Playwright tests.
- Create: `src/cli.ts` for Commander command registration.
- Create: `src/index.ts` for the executable entry point.
- Create: `src/errors.ts` for typed errors and exit-code mapping.
- Create: `src/config/paths.ts` for profile and output paths.
- Create: `src/jobs/schema.ts` for Zod schemas and exported job types.
- Create: `src/jobs/runner.ts` for serial batch execution.
- Create: `src/output/artifacts.ts` for metadata and artifact file naming.
- Create: `src/browser/session.ts` for persistent Playwright browser sessions.
- Create: `src/flow/locators.ts` for UI selector definitions.
- Create: `src/flow/page.ts` for high-level Flow UI operations.
- Create: `src/flow/types.ts` for the automation interface and result types.
- Create: `tests/errors.test.ts` for error mapping.
- Create: `tests/jobs.schema.test.ts` for schema behavior.
- Create: `tests/output.artifacts.test.ts` for output metadata behavior.
- Create: `tests/jobs.runner.test.ts` for serial batch execution.
- Create: `tests/cli.test.ts` for command parsing and exit handling.
- Create: `tests/flow.fixture.test.ts` for Playwright fixture automation.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.gitignore`

- [ ] **Step 1: Create scaffold files**

Create `package.json`:

```json
{
  "name": "google-flow-cli",
  "version": "0.1.0",
  "description": "Local browser automation CLI for Google Flow.",
  "type": "module",
  "bin": {
    "gflow": "./dist/src/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:flow-fixture": "vitest run tests/flow.fixture.test.ts",
    "doctor": "tsx src/index.ts doctor"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@playwright/test": "^1.44.0",
    "commander": "^12.1.0",
    "playwright": "^1.44.0",
    "yaml": "^2.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@eslint/js": "^9.4.0",
    "@types/node": "^20.14.2",
    "eslint": "^9.4.0",
    "tsx": "^4.15.1",
    "typescript": "^5.4.5",
    "typescript-eslint": "^8.60.1",
    "vitest": "^1.6.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `eslint.config.js`:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "gflow-output/**", ".gflow/**"]
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json"
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
);
```

Create `.gitignore`:

```gitignore
node_modules/
.npm-cache/
dist/
coverage/
.gflow/
gflow-output/
*.log
.DS_Store
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and dependencies install without errors.

- [ ] **Step 3: Verify scaffold commands fail for missing source**

Run:

```bash
npm run build
```

Expected: TypeScript reports that no input files exist because `src/` has not been created yet.

- [ ] **Step 4: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js .gitignore
git commit -m "chore: scaffold typescript cli project"
```

## Task 2: Typed Errors and Exit Codes

**Files:**
- Create: `src/errors.ts`
- Create: `tests/errors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CreditLimitError,
  DownloadError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError,
  exitCodeForError,
  messageForError
} from "../src/errors.js";

describe("exitCodeForError", () => {
  it("maps local and UI errors to stable exit codes", () => {
    expect(exitCodeForError(new LoginRequiredError())).toBe(2);
    expect(exitCodeForError(new ManualActionRequiredError("Consent dialog"))).toBe(2);
    expect(exitCodeForError(new UiContractError("Prompt box"))).toBe(3);
    expect(exitCodeForError(new GenerationBlockedError("Policy block"))).toBe(4);
    expect(exitCodeForError(new RateLimitedError("Too fast"))).toBe(5);
    expect(exitCodeForError(new CreditLimitError("No credits"))).toBe(6);
    expect(exitCodeForError(new GenerationFailedError("Generation failed"))).toBe(7);
    expect(exitCodeForError(new DownloadError("Missing download"))).toBe(8);
    expect(exitCodeForError(new Error("Unknown"))).toBe(1);
  });
});

describe("messageForError", () => {
  it("returns actionable messages without stack traces", () => {
    const message = messageForError(new LoginRequiredError());
    expect(message).toContain("Run `gflow auth login`");
    expect(message).not.toContain("at ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/errors.test.ts
```

Expected: FAIL because `src/errors.ts` does not exist.

- [ ] **Step 3: Implement typed errors**

Create `src/errors.ts`:

```ts
export class GFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class LoginRequiredError extends GFlowError {
  constructor(message = "Google Flow login is required. Run `gflow auth login` and complete login in the browser.") {
    super("LOGIN_REQUIRED", message);
  }
}

export class ManualActionRequiredError extends GFlowError {
  constructor(message: string) {
    super("MANUAL_ACTION_REQUIRED", `Manual action required in the Flow browser: ${message}`);
  }
}

export class UiContractError extends GFlowError {
  constructor(message: string) {
    super("UI_CONTRACT_CHANGED", `Google Flow UI contract changed or could not be detected: ${message}`);
  }
}

export class GenerationBlockedError extends GFlowError {
  constructor(message: string) {
    super("GENERATION_BLOCKED", `Flow blocked this generation: ${message}`);
  }
}

export class RateLimitedError extends GFlowError {
  constructor(message: string) {
    super("RATE_LIMITED", `Flow reported rate limiting or unusual activity: ${message}`);
  }
}

export class CreditLimitError extends GFlowError {
  constructor(message: string) {
    super("CREDIT_LIMIT", `Flow reported a credit or quota problem: ${message}`);
  }
}

export class GenerationFailedError extends GFlowError {
  constructor(message: string) {
    super("GENERATION_FAILED", `Flow generation failed: ${message}`);
  }
}

export class DownloadError extends GFlowError {
  constructor(message: string) {
    super("DOWNLOAD_FAILED", `Generated output could not be downloaded: ${message}`);
  }
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof LoginRequiredError) return 2;
  if (error instanceof ManualActionRequiredError) return 2;
  if (error instanceof UiContractError) return 3;
  if (error instanceof GenerationBlockedError) return 4;
  if (error instanceof RateLimitedError) return 5;
  if (error instanceof CreditLimitError) return 6;
  if (error instanceof GenerationFailedError) return 7;
  if (error instanceof DownloadError) return 8;
  return 1;
}

export function messageForError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/errors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit errors**

Run:

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: add typed cli errors"
```

## Task 3: Job Schema and YAML Loading

**Files:**
- Create: `src/jobs/schema.ts`
- Create: `tests/jobs.schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `tests/jobs.schema.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/jobs.schema.test.ts
```

Expected: FAIL because `src/jobs/schema.ts` does not exist.

- [ ] **Step 3: Implement schema**

Create `src/jobs/schema.ts`:

```ts
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
  ingredients: z.array(z.string().min(1)).default([])
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/jobs.schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit schema**

Run:

```bash
git add src/jobs/schema.ts tests/jobs.schema.test.ts
git commit -m "feat: add generation job schemas"
```

## Task 4: Output Paths and Metadata

**Files:**
- Create: `src/config/paths.ts`
- Create: `src/output/artifacts.ts`
- Create: `tests/output.artifacts.test.ts`

- [ ] **Step 1: Write failing output tests**

Create `tests/output.artifacts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/output.artifacts.test.ts
```

Expected: FAIL because output helpers do not exist.

- [ ] **Step 3: Implement path and artifact helpers**

Create `src/config/paths.ts`:

```ts
import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveProfileDir(profile: string): string {
  return resolve(process.cwd(), ".gflow", "profiles", profile);
}

export function resolveOutputDir(outDir: string): string {
  return resolve(process.cwd(), outDir);
}

export function defaultCacheDir(): string {
  return resolve(homedir(), ".cache", "gflow");
}
```

Create `src/output/artifacts.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ArtifactPlanInput {
  outDir: string;
  jobId: string;
  index: number;
  extension: string;
}

export interface ArtifactPlan {
  assetPath: string;
  metadataPath: string;
}

export interface ArtifactMetadata {
  jobId: string;
  type: "image" | "video";
  prompt: string;
  project?: string;
  model?: string;
  ratio?: string;
  duration?: number;
  requestedOutputs: number;
  downloadedAt: string;
  source: "google-flow-browser";
  flowUrl: string;
  status: "downloaded";
}

export function createArtifactPlan(input: ArtifactPlanInput): ArtifactPlan {
  const cleanExtension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const index = String(input.index).padStart(3, "0");
  const jobDir = join(input.outDir, input.jobId);
  const basename = `${input.jobId}-${index}`;

  return {
    assetPath: join(jobDir, `${basename}${cleanExtension}`),
    metadataPath: join(jobDir, `${basename}.json`)
  };
}

export async function writeArtifactMetadata(path: string, metadata: ArtifactMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/output.artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit output helpers**

Run:

```bash
git add src/config/paths.ts src/output/artifacts.ts tests/output.artifacts.test.ts
git commit -m "feat: add artifact output helpers"
```

## Task 5: Serial Job Runner

**Files:**
- Create: `src/flow/types.ts`
- Create: `src/jobs/runner.ts`
- Create: `tests/jobs.runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `tests/jobs.runner.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/jobs.runner.test.ts
```

Expected: FAIL because runner and automation types do not exist.

- [ ] **Step 3: Implement automation types and runner**

Create `src/flow/types.ts`:

```ts
import type { GFlowJob } from "../jobs/schema.js";

export interface FlowArtifact {
  path: string;
  metadataPath: string;
}

export interface FlowJobResult {
  jobId: string;
  artifacts: FlowArtifact[];
  flowUrl: string;
}

export interface FlowAutomationRunInput {
  job: GFlowJob;
  outDir: string;
}

export interface FlowAutomation {
  runJob(input: FlowAutomationRunInput): Promise<FlowJobResult>;
}
```

Create `src/jobs/runner.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/jobs.runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit runner**

Run:

```bash
git add src/flow/types.ts src/jobs/runner.ts tests/jobs.runner.test.ts
git commit -m "feat: add serial job runner"
```

## Task 6: Browser Session and Flow Page Fixture

**Files:**
- Create: `src/browser/session.ts`
- Create: `src/flow/locators.ts`
- Create: `src/flow/page.ts`
- Create: `fixtures/flow/index.html`
- Create: `tests/flow.fixture.test.ts`

- [ ] **Step 1: Write failing fixture test**

Create `tests/flow.fixture.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/flow.fixture.test.ts
```

Expected: FAIL because Flow page files and fixture do not exist.

- [ ] **Step 3: Implement browser session**

Create `src/browser/session.ts`:

```ts
import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveProfileDir } from "../config/paths.js";

export interface BrowserSessionOptions {
  profile: string;
  headed: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(resolveProfileDir(options.profile), {
    headless: !options.headed,
    acceptDownloads: true
  });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    async close() {
      await context.close();
    }
  };
}
```

- [ ] **Step 4: Implement locators and Flow page**

Create `src/flow/locators.ts`:

```ts
import type { Page } from "playwright";

export function flowLocators(page: Page) {
  return {
    promptBox: page.getByLabel("Prompt"),
    generateButton: page.getByRole("button", { name: /generate/i }),
    imageModeButton: page.getByRole("button", { name: /image/i }),
    videoModeButton: page.getByRole("button", { name: /video/i }),
    projectInput: page.getByLabel("Project"),
    modelInput: page.getByLabel("Model"),
    ratioInput: page.getByLabel("Aspect ratio"),
    durationInput: page.getByLabel("Duration"),
    outputCountInput: page.getByLabel("Outputs"),
    downloadLinks: page.getByRole("link", { name: /download/i }),
    loginMarker: page.getByTestId("flow-ready"),
    manualActionMarker: page.getByText(/manual action|sign in|verify|consent/i),
    rateLimitMarker: page.getByText(/too quickly|unusual activity|rate limit/i),
    creditMarker: page.getByText(/credit|quota/i),
    blockedMarker: page.getByText(/blocked|policy|cannot help/i),
    failedMarker: page.getByText(/failed|try again/i)
  };
}
```

Create `src/flow/page.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { Locator, Page } from "playwright";
import {
  CreditLimitError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError
} from "../errors.js";
import { createArtifactPlan, writeArtifactMetadata } from "../output/artifacts.js";
import type { FlowAutomation, FlowAutomationRunInput, FlowJobResult } from "./types.js";
import { flowLocators } from "./locators.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";

async function fillOptional(locator: Locator, value: string | number | undefined): Promise<void> {
  if (value === undefined) return;
  if ((await locator.count()) === 0) return;
  await locator.fill(String(value));
}

export class FlowPage implements FlowAutomation {
  constructor(private readonly page: Page, private readonly flowUrl = FLOW_URL) {}

  async open(): Promise<void> {
    await this.page.goto(this.flowUrl);
  }

  async assertReady(): Promise<void> {
    const locators = flowLocators(this.page);
    if ((await locators.manualActionMarker.count()) > 0) {
      throw new ManualActionRequiredError("Flow requires login, consent, or verification.");
    }
    if ((await locators.promptBox.count()) === 0) {
      throw new LoginRequiredError();
    }
  }

  async runJob(input: FlowAutomationRunInput): Promise<FlowJobResult> {
    const locators = flowLocators(this.page);
    await this.assertReady();

    if (input.job.type === "image") {
      await locators.imageModeButton.click();
    } else {
      await locators.videoModeButton.click();
    }

    await fillOptional(locators.projectInput, input.job.project);
    await fillOptional(locators.modelInput, input.job.model);
    await fillOptional(locators.ratioInput, input.job.ratio);
    await fillOptional(locators.outputCountInput, input.job.outputs);

    if (input.job.type === "video") {
      await fillOptional(locators.durationInput, input.job.duration);
    }

    if ((await locators.promptBox.count()) === 0) {
      throw new UiContractError("Prompt box is missing.");
    }

    const generationTimeoutSeconds = input.job.timeout ?? (input.job.type === "video" ? 1800 : 900);
    await locators.promptBox.fill(input.job.prompt);
    await locators.generateButton.click();
    await this.waitForBlockingStates(generationTimeoutSeconds * 1000);

    const artifacts = [];
    const downloadCount = Math.min(input.job.outputs, await locators.downloadLinks.count());

    if (downloadCount === 0) {
      throw new GenerationFailedError("No downloadable results appeared.");
    }

    for (let index = 0; index < downloadCount; index += 1) {
      const download = await Promise.all([
        this.page.waitForEvent("download"),
        locators.downloadLinks.nth(index).click()
      ]).then(([downloadResult]) => downloadResult);
      const suggested = download.suggestedFilename();
      const extension = extname(suggested) || (input.job.type === "video" ? ".mp4" : ".png");
      const plan = createArtifactPlan({
        outDir: input.outDir,
        jobId: input.job.id,
        index: index + 1,
        extension
      });

      await mkdir(dirname(plan.assetPath), { recursive: true });
      await download.saveAs(plan.assetPath);
      await writeArtifactMetadata(plan.metadataPath, {
        jobId: input.job.id,
        type: input.job.type,
        prompt: input.job.prompt,
        project: input.job.project,
        model: input.job.model,
        ratio: input.job.ratio,
        duration: input.job.type === "video" ? input.job.duration : undefined,
        requestedOutputs: input.job.outputs,
        downloadedAt: new Date().toISOString(),
        source: "google-flow-browser",
        flowUrl: this.page.url(),
        status: "downloaded"
      });
      artifacts.push({ path: plan.assetPath, metadataPath: plan.metadataPath });
    }

    return {
      jobId: input.job.id,
      artifacts,
      flowUrl: this.page.url()
    };
  }

  private async waitForBlockingStates(timeout: number): Promise<void> {
    const locators = flowLocators(this.page);
    await Promise.race([
      locators.downloadLinks.first().waitFor({ state: "visible", timeout }),
      locators.rateLimitMarker.waitFor({ state: "visible", timeout }).then(() => {
        throw new RateLimitedError("Flow displayed a rate limit or unusual activity message.");
      }),
      locators.creditMarker.waitFor({ state: "visible", timeout }).then(() => {
        throw new CreditLimitError("Flow displayed a credit or quota message.");
      }),
      locators.blockedMarker.waitFor({ state: "visible", timeout }).then(() => {
        throw new GenerationBlockedError("Flow displayed a policy block message.");
      }),
      locators.failedMarker.waitFor({ state: "visible", timeout }).then(() => {
        throw new GenerationFailedError("Flow displayed a generation failed message.");
      })
    ]);
  }
}
```

- [ ] **Step 5: Create local fixture**

Create `fixtures/flow/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Flow Fixture</title>
  </head>
  <body>
    <main data-testid="flow-ready">
      <label>
        Project
        <input aria-label="Project" />
      </label>
      <button>Image</button>
      <button>Video</button>
      <label>
        Prompt
        <textarea aria-label="Prompt"></textarea>
      </label>
      <label>
        Model
        <input aria-label="Model" />
      </label>
      <label>
        Aspect ratio
        <input aria-label="Aspect ratio" />
      </label>
      <label>
        Duration
        <input aria-label="Duration" />
      </label>
      <label>
        Outputs
        <input aria-label="Outputs" />
      </label>
      <button id="generate">Generate</button>
      <section id="results"></section>
    </main>
    <script>
      document.getElementById("generate").addEventListener("click", () => {
        const link = document.createElement("a");
        link.textContent = "Download";
        link.setAttribute("aria-label", "Download generated image");
        link.href = "data:image/png;base64,Zml4dHVyZSBhc3NldA==";
        link.download = "fixture.png";
        document.getElementById("results").appendChild(link);
      });
    </script>
  </body>
</html>
```

- [ ] **Step 6: Run fixture test**

Run:

```bash
npm test -- tests/flow.fixture.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit browser automation fixture**

Run:

```bash
git add src/browser/session.ts src/flow/locators.ts src/flow/page.ts fixtures/flow/index.html tests/flow.fixture.test.ts
git commit -m "feat: add flow browser automation fixture"
```

## Task 7: CLI Commands

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `tests/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `tests/cli.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { FlowAutomation } from "../src/flow/types.js";
import { createProgram } from "../src/cli.js";

describe("CLI", () => {
  it("runs an image command through automation", async () => {
    const automation: FlowAutomation = {
      runJob: vi.fn(async () => ({
        jobId: "cli-image",
        artifacts: [],
        flowUrl: "https://labs.google/fx/tools/flow"
      }))
    };
    const program = createProgram({ automation });

    await program.parseAsync([
      "node",
      "gflow",
      "image",
      "--id",
      "cli-image",
      "--prompt",
      "Prompt"
    ]);

    expect(automation.runJob).toHaveBeenCalledWith({
      job: expect.objectContaining({
        id: "cli-image",
        type: "image",
        prompt: "Prompt"
      }),
      outDir: expect.stringContaining("gflow-output")
    });
  });

  it("supports batch command with continue-on-failure flag", async () => {
    const automation: FlowAutomation = {
      runJob: vi.fn(async (input) => ({
        jobId: input.job.id,
        artifacts: [],
        flowUrl: "https://labs.google/fx/tools/flow"
      }))
    };
    const program = createProgram({ automation });

    await program.parseAsync([
      "node",
      "gflow",
      "batch",
      "examples/pipeline.yaml",
      "--continue-on-failure"
    ]);

    expect(automation.runJob).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL because CLI files and example pipeline do not exist.

- [ ] **Step 3: Create example pipeline**

Create `examples/pipeline.yaml`:

```yaml
jobs:
  - id: concept-image
    type: image
    project: Summer Campaign
    prompt: "Minimal editorial product still on a warm studio background"
    model: nano-banana-pro
    ratio: "1:1"
    outputs: 1

  - id: hero-video
    type: video
    project: Summer Campaign
    prompt: "A cinematic product reveal on a sunlit table, slow dolly in"
    model: veo-3.1-fast
    duration: 8
    ratio: "16:9"
    outputs: 1
```

- [ ] **Step 4: Implement CLI**

Create `src/cli.ts`:

```ts
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { openBrowserSession } from "./browser/session.js";
import { exitCodeForError, messageForError } from "./errors.js";
import { FlowPage } from "./flow/page.js";
import type { FlowAutomation } from "./flow/types.js";
import { parseBatchYaml, parseImageJob, parseVideoJob } from "./jobs/schema.js";
import { runJobs } from "./jobs/runner.js";
import { resolveOutputDir } from "./config/paths.js";

export interface CreateProgramOptions {
  automation?: FlowAutomation;
}

async function realAutomation(profile: string, headed: boolean): Promise<{ automation: FlowAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed });
  const flow = new FlowPage(session.page);
  await flow.open();
  return {
    automation: flow,
    close: () => session.close()
  };
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();
  program.name("gflow").description("Local browser automation CLI for Google Flow.").version("0.1.0");

  program
    .command("auth login")
    .option("--profile <name>", "browser profile name", "default")
    .action(async (command) => {
      const session = await openBrowserSession({ profile: command.profile, headed: true });
      await session.page.goto("https://labs.google/fx/tools/flow");
      console.log("Complete login in the browser, then run `gflow doctor`.");
    });

  program
    .command("doctor")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser", false)
    .action(async (command) => {
      const owned = await realAutomation(command.profile, command.headed);
      try {
        if (owned.automation instanceof FlowPage) {
          await owned.automation.assertReady();
        }
        console.log("gflow doctor: Flow browser session looks ready.");
      } finally {
        await owned.close();
      }
    });

  program
    .command("image")
    .requiredOption("--id <id>", "job id")
    .requiredOption("--prompt <text>", "generation prompt")
    .option("--project <name>", "Flow project")
    .option("--model <name>", "Flow-visible model")
    .option("--ratio <ratio>", "Flow-visible aspect ratio")
    .option("--outputs <n>", "number of outputs", (value) => Number.parseInt(value, 10), 1)
    .option("--timeout <seconds>", "generation timeout in seconds", (value) => Number.parseInt(value, 10))
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser", true)
    .action(async (command) => {
      const job = parseImageJob({
        id: command.id,
        type: "image",
        prompt: command.prompt,
        project: command.project,
        model: command.model,
        ratio: command.ratio,
        outputs: command.outputs,
        timeout: command.timeout,
        out: command.out
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation ? { automation: options.automation, close: async () => undefined } : await realAutomation(command.profile, command.headed);
      try {
        await owned.automation.runJob({ job, outDir });
      } finally {
        await owned.close();
      }
    });

  program
    .command("video")
    .requiredOption("--id <id>", "job id")
    .requiredOption("--prompt <text>", "generation prompt")
    .option("--project <name>", "Flow project")
    .option("--model <name>", "Flow-visible model")
    .option("--ratio <ratio>", "Flow-visible aspect ratio")
    .option("--duration <seconds>", "Flow-visible duration", (value) => Number.parseInt(value, 10))
    .option("--outputs <n>", "number of outputs", (value) => Number.parseInt(value, 10), 1)
    .option("--timeout <seconds>", "generation timeout in seconds", (value) => Number.parseInt(value, 10))
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser", true)
    .action(async (command) => {
      const job = parseVideoJob({
        id: command.id,
        type: "video",
        prompt: command.prompt,
        project: command.project,
        model: command.model,
        ratio: command.ratio,
        duration: command.duration,
        outputs: command.outputs,
        timeout: command.timeout,
        out: command.out
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation ? { automation: options.automation, close: async () => undefined } : await realAutomation(command.profile, command.headed);
      try {
        await owned.automation.runJob({ job, outDir });
      } finally {
        await owned.close();
      }
    });

  program
    .command("batch")
    .argument("<file>", "YAML pipeline file")
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser", true)
    .option("--continue-on-failure", "continue after ordinary generation failures", false)
    .action(async (file, command) => {
      const batch = parseBatchYaml(await readFile(file, "utf8"));
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation ? { automation: options.automation, close: async () => undefined } : await realAutomation(command.profile, command.headed);
      try {
        await runJobs({
          jobs: batch.jobs.map((job) => ({ ...job, out: command.out })),
          outDir,
          continueOnFailure: command.continueOnFailure,
          automation: owned.automation
        });
      } finally {
        await owned.close();
      }
    });

  program.exitOverride();
  program.configureOutput({
    writeErr: (text) => process.stderr.write(text)
  });

  return program;
}

export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    console.error(messageForError(error));
    return exitCodeForError(error);
  }
}
```

Create `src/index.ts`:

```ts
#!/usr/bin/env node
import { runCli } from "./cli.js";

const exitCode = await runCli(process.argv);
process.exitCode = exitCode;
```

- [ ] **Step 5: Run CLI tests**

Run:

```bash
npm test -- tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit CLI**

Run:

```bash
git add src/cli.ts src/index.ts tests/cli.test.ts examples/pipeline.yaml
git commit -m "feat: add gflow cli commands"
```

## Task 8: Docs and Verification

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Create README**

Create `README.md`:

````md
# gflow

`gflow` is a local CLI for driving Google Flow through a visible Playwright browser session. It uses your own logged-in Flow account and normal Flow UI controls.

## Boundaries

`gflow` does not replay private Google APIs, bypass login, solve CAPTCHA, rotate accounts, strip watermarks, or evade Flow rate limits. If Flow asks for manual action, the CLI stops and tells you what to do.

## Install

```bash
npm install
npm run build
npx playwright install chromium
```

## Login

```bash
npm run dev -- auth login
```

Complete Google login in the browser. Browser profile state is stored in `.gflow/profiles/default`.

## Doctor

```bash
npm run dev -- doctor
```

`doctor` checks whether Flow opens, the profile appears logged in, and the expected UI controls are visible.

## Image

```bash
npm run dev -- image \
  --id concept-image \
  --project "Summer Campaign" \
  --prompt "Minimal editorial product still on a warm studio background" \
  --model nano-banana-pro \
  --ratio 1:1 \
  --outputs 1 \
  --out ./gflow-output
```

## Video

```bash
npm run dev -- video \
  --id hero-video \
  --project "Summer Campaign" \
  --prompt "A cinematic product reveal on a sunlit table, slow dolly in" \
  --model veo-3.1-fast \
  --duration 8 \
  --ratio 16:9 \
  --outputs 1 \
  --out ./gflow-output
```

## Batch

```bash
npm run dev -- batch examples/pipeline.yaml --out ./gflow-output
```

Outputs are written as:

```text
gflow-output/
  gflow-run.json
  <job-id>/
    <job-id>-001.png
    <job-id>-001.json
```
````

- [ ] **Step 2: Build, lint, and test**

Run:

```bash
npm run build
npm run lint
npm test
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run fixture test**

Run:

```bash
npm run test:flow-fixture
```

Expected: PASS.

- [ ] **Step 4: Check CLI help**

Run:

```bash
npm run dev -- --help
npm run dev -- image --help
npm run dev -- video --help
npm run dev -- batch --help
```

Expected: each command prints usage text and exits `0`.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md package.json
git commit -m "docs: add gflow usage guide"
```

## Task 9: Manual Real-Flow Smoke Check

**Files:**
- No source files are changed by this task.
- Generated files may appear under `.gflow/` and `gflow-output/`, both ignored by git.

- [ ] **Step 1: Install Chromium browser if missing**

Run:

```bash
npx playwright install chromium
```

Expected: Playwright reports Chromium is installed.

- [ ] **Step 2: Open login session**

Run:

```bash
npm run dev -- auth login
```

Expected: a visible browser opens to Google Flow. Complete login manually.

- [ ] **Step 3: Run doctor**

Run:

```bash
npm run dev -- doctor
```

Expected: either `gflow doctor: Flow browser session looks ready.` or a clear manual-action/login/UI-contract error.

- [ ] **Step 4: Run one low-cost image command after confirming credits in Flow**

Run:

```bash
npm run dev -- image --id smoke-image --prompt "Simple abstract color card" --outputs 1 --out ./gflow-output
```

Expected: one image asset and one metadata JSON file appear in `gflow-output/smoke-image/`, or the CLI stops with a clear Flow UI/runtime error.

- [ ] **Step 5: Record manual result**

Add a short note to the final response with the command result, output path if created, and any UI selector drift found. Do not commit generated media or browser profiles.
