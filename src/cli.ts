import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { BROWSER_CHANNELS, DEFAULT_BROWSER_CHANNEL, launchLoginChrome, openBrowserSession, type BrowserChannel } from "./browser/session.js";
import { exitCodeForError, messageForError } from "./errors.js";
import { FlowPage, FLOW_URL } from "./flow/page.js";
import type { AgentAutomation, CharacterAutomation, FlowAutomation, ToolAutomation } from "./flow/types.js";
import { AgentPage } from "./flow/agent.js";
import { CharacterPage } from "./flow/characters.js";
import { ToolPage } from "./flow/tools.js";
import { parseAgentInstruction, parseAgentRun, parseAgentSettings, parseBatchYaml, parseCharacter, parseImageJob, parseTool, parseVideoJob } from "./jobs/schema.js";
import { runJobs } from "./jobs/runner.js";
import { resolveOutputDir } from "./config/paths.js";

export interface CreateProgramOptions {
  automation?: FlowAutomation;
  characterAutomation?: CharacterAutomation;
  toolAutomation?: ToolAutomation;
  agentAutomation?: AgentAutomation;
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

function commandOption<T>(command: unknown, key: string): T | undefined {
  if (command === null || typeof command !== "object") return undefined;
  const record = command as Record<string, unknown>;
  if (record[key] !== undefined) return record[key] as T;
  const optsWithGlobals = record.optsWithGlobals;
  if (typeof optsWithGlobals === "function") {
    const value = (optsWithGlobals.call(command) as Record<string, unknown>)[key];
    if (value !== undefined) return value as T;
  }
  const opts = record.opts;
  if (typeof opts === "function") {
    const value = (opts.call(command) as Record<string, unknown>)[key];
    if (value !== undefined) return value as T;
  }
  return undefined;
}

// Read the CLI version from package.json so `--version` never drifts from the package.
// Dev runs this file from src/ (package.json one level up); the build runs it from
// dist/src/ (two levels up), so try both anchors relative to this module.
export function resolveVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      return (JSON.parse(readFileSync(join(here, rel), "utf8")) as { version: string }).version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
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

function withSessionOptions(command: Command): Command {
  return command
    .option("--project <name>", "Flow project")
    .option("--profile <name>", "browser profile name", "default")
    .option("--browser <name>", "browser channel for Flow automation: chrome or chromium", parseBrowserOption, DEFAULT_BROWSER_CHANNEL)
    .option("--headed", "show browser", true)
    .option("--no-headed", "run browser headless");
}

function nestedSessionOptions(commandOptions: unknown, command: unknown): {
  project?: string;
  profile: string;
  headed: boolean;
  browser: BrowserChannel;
} {
  return {
    project: commandOption<string>(command, "project") ?? commandOption<string>(commandOptions, "project"),
    profile: commandOption<string>(command, "profile") ?? commandOption<string>(commandOptions, "profile") ?? "default",
    headed: commandOption<boolean>(command, "headed") ?? commandOption<boolean>(commandOptions, "headed") ?? true,
    browser: commandOption<BrowserChannel>(command, "browser") ?? commandOption<BrowserChannel>(commandOptions, "browser") ?? DEFAULT_BROWSER_CHANNEL
  };
}

async function realCharacterAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: CharacterAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new CharacterPage(session.page), close: () => session.close() };
}

async function realToolAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: ToolAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new ToolPage(session.page), close: () => session.close() };
}

async function realAgentAutomation(profile: string, headed: boolean, browser: BrowserChannel): Promise<{ automation: AgentAutomation; close(): Promise<void> }> {
  const session = await openBrowserSession({ profile, headed, browser });
  await session.page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  return { automation: new AgentPage(session.page), close: () => session.close() };
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();
  program.name("gflow").description("Local browser automation CLI for Google Flow.").version(resolveVersion());
  program.exitOverride();

  const auth = program.command("auth").description("Manage the local Flow browser session.");
  auth
    .command("login")
    .description("Open a plain Chrome to sign in to Google Flow (run before other commands).")
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
    .description("Check that the Flow browser session is signed in and ready.")
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
    .description("Generate an image from a text prompt.")
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
    .description("Generate a video from a prompt (text-to-video, or frames with --start-frame/--end-frame).")
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
    .description("Run a YAML pipeline of image/video jobs.")
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

  const character = program.command("character").description("Create and manage Flow characters.");
  withSessionOptions(character.command("create").description("Create a character from a prompt and optional reference images."))
    .requiredOption("--prompt <text>", "character description")
    .option("--name <name>", "character name")
    .option("--model <model>", "nano-banana-2 or nano-banana-pro", (v) => {
      if (!["nano-banana-2", "nano-banana-pro"].includes(v)) throw new InvalidArgumentError("must be nano-banana-2 or nano-banana-pro");
      return v;
    })
    .option("--preset <preset>", "familiar|eccentric|wicked|fantastical")
    .option("--image <path...>", "reference image(s) to upload")
    .option("--from-project <name...>", "reference asset name(s) from the project")
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      const spec = parseCharacter({
        prompt: command.prompt,
        name: command.name,
        model: command.model,
        preset: command.preset,
        images: (command.image ?? []).map((p: string) => resolve(process.cwd(), p)),
        fromProject: command.fromProject ?? [],
        project: command.project,
        out: command.out
      });
      const owned = options.characterAutomation
        ? { automation: options.characterAutomation, close: async () => undefined }
        : await realCharacterAutomation(command.profile, command.headed, command.browser);
      try {
        const result = await owned.automation.createCharacter({ ...spec, outDir: resolveOutputDir(spec.out) });
        console.log(`character created: ${result.name}`);
        if (result.thumbnailPath) console.log(`saved ${result.thumbnailPath}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(character.command("list").description("List the project's characters.")).action(async (command) => {
    const owned = options.characterAutomation
      ? { automation: options.characterAutomation, close: async () => undefined }
      : await realCharacterAutomation(command.profile, command.headed, command.browser);
    try {
      for (const c of await owned.automation.listCharacters(command.project)) console.log(c.name);
    } finally {
      await owned.close();
    }
  });

  const tool = program.command("tool").description("Create and open Flow tools.");
  withSessionOptions(tool.command("create").description("Build a Flow tool (applet) from a description."))
    .requiredOption("--prompt <text>", "describe the tool to build")
    .option("--name <name>", "label for the created tool")
    .option("--preset <preset>", "image-filter|style-morph|time-stretcher|voice-over")
    .action(async (command) => {
      const spec = parseTool({ prompt: command.prompt, name: command.name, preset: command.preset, project: command.project });
      const owned = options.toolAutomation
        ? { automation: options.toolAutomation, close: async () => undefined }
        : await realToolAutomation(command.profile, command.headed, command.browser);
      try {
        const r = await owned.automation.createTool(spec);
        console.log(`tool created: ${r.name}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(tool.command("list").description("List the project's tools.")).action(async (command) => {
    const owned = options.toolAutomation
      ? { automation: options.toolAutomation, close: async () => undefined }
      : await realToolAutomation(command.profile, command.headed, command.browser);
    try {
      for (const t of await owned.automation.listTools(command.project)) console.log(t.name);
    } finally {
      await owned.close();
    }
  });

  withSessionOptions(tool.command("open").description("Open a tool by name."))
    .requiredOption("--name <name>", "tool to open")
    .action(async (command) => {
      const owned = options.toolAutomation
        ? { automation: options.toolAutomation, close: async () => undefined }
        : await realToolAutomation(command.profile, command.headed, command.browser);
      try {
        await owned.automation.openTool(command.name, command.project);
        console.log(`opened ${command.name}`);
      } finally {
        await owned.close();
      }
    });

  const agent = program.command("agent").description("Run and configure the Flow Agent.");
  withSessionOptions(agent)
    .option("--prompt <text>", "agent prompt")
    .option("--id <id>", "job id for outputs", "agent")
    .option("--out <path>", "output directory", "./gflow-output")
    .action(async (command) => {
      if (!command.prompt) {
        agent.help();
        return;
      }
      const spec = parseAgentRun({ id: command.id, prompt: command.prompt, project: command.project, out: command.out });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(command.profile, command.headed, command.browser);
      try {
        const r = await owned.automation.runAgent({ ...spec, outDir: resolveOutputDir(spec.out) });
        for (const a of r.artifacts) console.log(`saved ${a.path}`);
      } finally {
        await owned.close();
      }
    });

  withSessionOptions(agent.command("settings").description("Set the agent's image/video model, format, quantity, and confirmation mode."))
    .option("--confirm <mode>", "always or never", (v) => {
      if (!["always", "never"].includes(v)) throw new InvalidArgumentError("must be always or never");
      return v;
    })
    .option("--image-model <m>")
    .option("--image-ratio <r>")
    .option("--image-quantity <n>", "1-4", parseIntegerOption)
    .option("--video-model <m>")
    .option("--video-ratio <r>")
    .option("--video-quantity <n>", "1-4", parseIntegerOption)
    .action(async (commandOptions, command) => {
      const sessionOptions = nestedSessionOptions(commandOptions, command);
      const spec = parseAgentSettings({
        confirm: commandOptions.confirm,
        imageModel: commandOptions.imageModel,
        imageRatio: commandOptions.imageRatio,
        imageQuantity: commandOptions.imageQuantity,
        videoModel: commandOptions.videoModel,
        videoRatio: commandOptions.videoRatio,
        videoQuantity: commandOptions.videoQuantity,
        project: sessionOptions.project
      });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
      try {
        await owned.automation.applySettings(spec);
        console.log("agent settings saved");
      } finally {
        await owned.close();
      }
    });

  const instruction = agent.command("instruction").description("Manage agent instructions.");
  withSessionOptions(instruction.command("add").description("Add a guideline, optionally with a project image as reference."))
    .requiredOption("--text <guideline>", "guideline text")
    .option("--ref <name>", "project image to use as reference")
    .action(async (commandOptions, command) => {
      const sessionOptions = nestedSessionOptions(commandOptions, command);
      const spec = parseAgentInstruction({
        text: commandOptions.text,
        ref: commandOptions.ref,
        project: sessionOptions.project
      });
      const owned = options.agentAutomation
        ? { automation: options.agentAutomation, close: async () => undefined }
        : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
      try {
        await owned.automation.addInstruction(spec);
        console.log("instruction added");
      } finally {
        await owned.close();
      }
    });
  withSessionOptions(instruction.command("list").description("List the agent's instructions.")).action(async (commandOptions, command) => {
    const sessionOptions = nestedSessionOptions(commandOptions, command);
    const owned = options.agentAutomation
      ? { automation: options.agentAutomation, close: async () => undefined }
      : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
    try {
      for (const i of await owned.automation.listInstructions(sessionOptions.project)) console.log(i.text);
    } finally {
      await owned.close();
    }
  });
  withSessionOptions(instruction.command("clear").description("Remove all agent instructions.")).action(async (commandOptions, command) => {
    const sessionOptions = nestedSessionOptions(commandOptions, command);
    const owned = options.agentAutomation
      ? { automation: options.agentAutomation, close: async () => undefined }
      : await realAgentAutomation(sessionOptions.profile, sessionOptions.headed, sessionOptions.browser);
    try {
      await owned.automation.clearInstructions(sessionOptions.project);
      console.log("instructions cleared");
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
