import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { BROWSER_CHANNELS, DEFAULT_BROWSER_CHANNEL, launchLoginChrome, openBrowserSession, type BrowserChannel } from "./browser/session.js";
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

function parseBrowserOption(value: string): BrowserChannel {
  if (!BROWSER_CHANNELS.includes(value as BrowserChannel)) {
    throw new InvalidArgumentError(`must be one of: ${BROWSER_CHANNELS.join(", ")}`);
  }
  return value as BrowserChannel;
}

async function realAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: FlowAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
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
      // Launch a plain Chrome (no remote-debugging port) for sign-in. Google blocks sign-in
      // in browsers with remote debugging enabled ("this browser or app may not be secure"),
      // so login must happen in an ordinary window. Automation commands then reattach to this
      // profile with a debugging port once it is already signed in.
      const profileDir = await launchLoginChrome(command.profile);
      console.log(`Opened Google Chrome for login with profile: ${profileDir}`);
      console.log("Complete login in that window, then run `gflow doctor` (gflow reopens Chrome for automation).");
    });

  program
    .command("doctor")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .action(async (command) => {
      const owned = await realAutomation(command.profile, command.headed, command.browser);
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
    .option("--character <name...>", "reference saved character(s) by name")
    .option("--upscale <tier>", "download upscaled output: 2k or 4k", (v) => {
      if (!["2k", "4k"].includes(v)) throw new InvalidArgumentError("must be 2k or 4k");
      return v;
    })
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
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
        out: command.out,
        character: command.character ?? [],
        upscale: command.upscale
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation
        ? { automation: options.automation, close: async () => undefined }
        : await realAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.runJob({ job, outDir });
        for (const artifact of result.artifacts) {
          console.log(`saved ${artifact.path}`);
        }
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
    .option("--start-frame <path>", "first-frame image (switches Flow to Frames mode)")
    .option("--end-frame <path>", "last-frame image (Frames mode)")
    .option("--timeout <seconds>", "generation timeout in seconds", parseIntegerOption)
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--character <name...>", "reference saved character(s) by name")
    .option("--upscale <tier>", "download upscaled output: 2k or 4k", (v) => {
      if (!["2k", "4k"].includes(v)) throw new InvalidArgumentError("must be 2k or 4k");
      return v;
    })
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
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
        startFrame: command.startFrame ? resolve(process.cwd(), command.startFrame) : undefined,
        endFrame: command.endFrame ? resolve(process.cwd(), command.endFrame) : undefined,
        timeout: command.timeout,
        out: command.out,
        character: command.character ?? [],
        upscale: command.upscale
      });
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation
        ? { automation: options.automation, close: async () => undefined }
        : await realAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.runJob({ job, outDir });
        for (const artifact of result.artifacts) {
          console.log(`saved ${artifact.path}`);
        }
      } finally {
        await owned.close();
      }
    });

  program
    .command("batch")
    .argument("<file>", "YAML pipeline file")
    .option("--out <path>", "output directory", "./gflow-output")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless")
    .option("--continue-on-failure", "continue after ordinary generation failures", false)
    .action(async (file, command) => {
      const batch = parseBatchYaml(await readFile(file, "utf8"));
      const outDir = resolveOutputDir(command.out);
      const owned = options.automation
        ? { automation: options.automation, close: async () => undefined }
        : await realAutomation(command.profile, command.headed, command.browser);
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
