import { readFile } from "node:fs/promises";
import { Command, CommanderError, InvalidArgumentError } from "commander";
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

function parseIntegerOption(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return Number.parseInt(value, 10);
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
  program.exitOverride();

  const auth = program.command("auth").description("Manage the local Flow browser session.");
  auth
    .command("login")
    .option("--profile <name>", "browser profile name", "default")
    .action(async (command: { profile: string }) => {
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
    .option("--outputs <n>", "number of outputs", parseIntegerOption, 1)
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser")
    .option("--no-headed", "run browser headless")
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
    .option("--duration <seconds>", "Flow-visible duration", parseIntegerOption)
    .option("--outputs <n>", "number of outputs", parseIntegerOption, 1)
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--headed", "show browser")
    .option("--no-headed", "run browser headless")
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
    .option("--headed", "show browser")
    .option("--no-headed", "run browser headless")
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
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version" || error.code === "commander.invalidArgument")
    ) {
      return error.exitCode;
    }
    console.error(messageForError(error));
    return exitCodeForError(error);
  }
}
