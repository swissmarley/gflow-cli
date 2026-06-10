import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentAutomation, CharacterAutomation, FlowAutomation, SceneAutomation, ToolAutomation } from "../src/flow/types.js";
import { createProgram, runCli } from "../src/cli.js";

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

  it("returns zero for top-level help and version", async () => {
    await expect(runCli(["node", "gflow", "--help"])).resolves.toBe(0);
    await expect(runCli(["node", "gflow", "--version"])).resolves.toBe(0);
  });

  it("rejects malformed integer options", async () => {
    const program = createProgram({
      automation: {
        runJob: vi.fn()
      }
    });

    await expect(
      program.parseAsync(["node", "gflow", "image", "--id", "bad-number", "--prompt", "Prompt", "--outputs", "2abc"])
    ).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });
  });

  it("parses auth login as a subcommand", () => {
    const program = createProgram();
    const auth = program.commands.find((command) => command.name() === "auth");
    const login = auth?.commands.find((command) => command.name() === "login");

    expect(auth).toBeDefined();
    expect(login).toBeDefined();
    expect(login?.options.map((option) => option.long)).toContain("--profile");
  });

  it("uses Chrome by default for real browser commands and supports no-headed", async () => {
    const automation: FlowAutomation = {
      runJob: vi.fn(async () => ({
        jobId: "headed-image",
        artifacts: [],
        flowUrl: "https://labs.google/fx/tools/flow"
      }))
    };
    const program = createProgram({ automation });
    const image = program.commands.find((command) => command.name() === "image");

    await program.parseAsync(["node", "gflow", "image", "--id", "headed-image", "--prompt", "Prompt"]);
    expect(image?.opts().headed).toBe(true);
    expect(image?.opts().browser).toBe("chrome");

    await program.parseAsync(["node", "gflow", "image", "--id", "headless-image", "--prompt", "Prompt", "--browser", "chromium", "--no-headed"]);
    expect(image?.opts().headed).toBe(false);
    expect(image?.opts().browser).toBe("chromium");
  });

  it("runs doctor headed by default so Flow renders for a logged-in profile", () => {
    const program = createProgram();
    const doctor = program.commands.find((command) => command.name() === "doctor");
    const headed = doctor?.options.find((option) => option.long === "--headed");

    expect(headed?.defaultValue).toBe(true);
    expect(doctor?.options.map((option) => option.long)).toContain("--no-headed");
  });

  it("rejects unsupported browser channels", async () => {
    const program = createProgram({
      automation: {
        runJob: vi.fn()
      }
    });

    await expect(
      program.parseAsync(["node", "gflow", "image", "--id", "bad-browser", "--prompt", "Prompt", "--browser", "firefox"])
    ).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });
  });

  it("calls createCharacter with resolved image paths and parsed options", async () => {
    const characterAutomation: CharacterAutomation = {
      createCharacter: vi.fn(async () => ({
        name: "test-character",
        thumbnailPath: undefined,
        flowUrl: "https://labs.google/fx/tools/flow/characters"
      })),
      listCharacters: vi.fn(async () => [])
    };
    const program = createProgram({ characterAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "character",
      "create",
      "--prompt",
      "x",
      "--name",
      "test-character",
      "--model",
      "nano-banana-pro",
      "--image",
      "./a.png"
    ]);

    expect(characterAutomation.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "x",
        name: "test-character",
        model: "nano-banana-pro",
        images: expect.arrayContaining([
          expect.stringMatching(/\/a\.png$/)
        ])
      })
    );
    const call = vi.mocked(characterAutomation.createCharacter).mock.calls[0]?.[0];
    expect(call?.images[0]).toBe(resolve(process.cwd(), "./a.png"));
  });

  it("calls createTool with prompt and preset", async () => {
    const toolAutomation: ToolAutomation = {
      createTool: vi.fn(async () => ({
        name: "remove bg",
        flowUrl: "https://labs.google/fx/tools/flow/tools/123"
      })),
      listTools: vi.fn(async () => [{ name: "remove bg" }, { name: "style shift" }]),
      openTool: vi.fn(async () => undefined)
    };
    const program = createProgram({ toolAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "tool",
      "create",
      "--prompt",
      "remove bg",
      "--preset",
      "image-filter"
    ]);

    expect(toolAutomation.createTool).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "remove bg",
        preset: "image-filter"
      })
    );
  });

  it("calls listTools and prints tool names", async () => {
    const toolAutomation: ToolAutomation = {
      createTool: vi.fn(async () => ({
        name: "remove bg",
        flowUrl: "https://labs.google/fx/tools/flow/tools/123"
      })),
      listTools: vi.fn(async () => [{ name: "remove bg" }, { name: "style shift" }]),
      openTool: vi.fn(async () => undefined)
    };
    const program = createProgram({ toolAutomation });

    await program.parseAsync(["node", "gflow", "tool", "list"]);

    expect(toolAutomation.listTools).toHaveBeenCalled();
  });

  it("calls runAgent with id and prompt", async () => {
    const agentAutomation: AgentAutomation = {
      runAgent: vi.fn(async () => ({ jobId: "a1", artifacts: [], flowUrl: "" })),
      applySettings: vi.fn(async () => undefined),
      addInstruction: vi.fn(async () => undefined),
      listInstructions: vi.fn(async () => []),
      clearInstructions: vi.fn(async () => undefined)
    };
    const program = createProgram({ agentAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "agent",
      "--prompt",
      "make a teaser",
      "--id",
      "a1"
    ]);

    expect(agentAutomation.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", prompt: "make a teaser" })
    );
  });

  it("calls applySettings with parsed agent settings", async () => {
    const agentAutomation: AgentAutomation = {
      runAgent: vi.fn(async () => ({ jobId: "a1", artifacts: [], flowUrl: "" })),
      applySettings: vi.fn(async () => undefined),
      addInstruction: vi.fn(async () => undefined),
      listInstructions: vi.fn(async () => []),
      clearInstructions: vi.fn(async () => undefined)
    };
    const program = createProgram({ agentAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "agent",
      "settings",
      "--confirm",
      "never",
      "--image-quantity",
      "2",
      "--video-ratio",
      "9:16"
    ]);

    expect(agentAutomation.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({ confirm: "never", imageQuantity: 2, videoRatio: "9:16" })
    );
  });

  it("calls addInstruction with text and ref", async () => {
    const agentAutomation: AgentAutomation = {
      runAgent: vi.fn(async () => ({ jobId: "a1", artifacts: [], flowUrl: "" })),
      applySettings: vi.fn(async () => undefined),
      addInstruction: vi.fn(async () => undefined),
      listInstructions: vi.fn(async () => []),
      clearInstructions: vi.fn(async () => undefined)
    };
    const program = createProgram({ agentAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "agent",
      "instruction",
      "add",
      "--text",
      "cinematic",
      "--ref",
      "Hero"
    ]);

    expect(agentAutomation.addInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ text: "cinematic", ref: "Hero" })
    );
  });

  it("passes --project to nested agent instruction list", async () => {
    const agentAutomation: AgentAutomation = {
      runAgent: vi.fn(async () => ({ jobId: "a1", artifacts: [], flowUrl: "" })),
      applySettings: vi.fn(async () => undefined),
      addInstruction: vi.fn(async () => undefined),
      listInstructions: vi.fn(async () => []),
      clearInstructions: vi.fn(async () => undefined)
    };
    const program = createProgram({ agentAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "agent",
      "instruction",
      "list",
      "--project",
      "Jun 05, 02:36 AM"
    ]);

    expect(agentAutomation.listInstructions).toHaveBeenCalledWith("Jun 05, 02:36 AM");
  });

  it("collects repeated --prompt and --add-clip flags in order for extend", async () => {
    const sceneAutomation: SceneAutomation = {
      extendScene: vi.fn(async () => ({
        sceneId: "818777c1",
        totalDuration: "00:24:00",
        artifacts: [],
        flowUrl: "https://labs.google/fx/tools/flow/project/p/scene/818777c1"
      })),
      listScenes: vi.fn(async () => [])
    };
    const program = createProgram({ sceneAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "extend",
      "--media-id",
      "9b14ed49",
      "--prompt",
      "the wave crashes",
      "--prompt",
      "the sun sets",
      "--add-clip",
      "Hummingbird"
    ]);

    expect(sceneAutomation.extendScene).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: "9b14ed49",
        prompts: ["the wave crashes", "the sun sets"],
        addClips: ["Hummingbird"],
        download: true,
        outDir: expect.stringContaining("gflow-output")
      })
    );
  });

  it("supports continuing a scene with --scene and --no-download", async () => {
    const sceneAutomation: SceneAutomation = {
      extendScene: vi.fn(async () => ({
        sceneId: "818777c1",
        totalDuration: "00:32:00",
        artifacts: [],
        flowUrl: "https://labs.google/fx/tools/flow/project/p/scene/818777c1"
      })),
      listScenes: vi.fn(async () => [])
    };
    const program = createProgram({ sceneAutomation });

    await program.parseAsync([
      "node",
      "gflow",
      "extend",
      "--scene",
      "818777c1",
      "--prompt",
      "a boat appears on the horizon",
      "--no-download"
    ]);

    expect(sceneAutomation.extendScene).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: "818777c1",
        prompts: ["a boat appears on the horizon"],
        download: false
      })
    );
  });

  it("rejects extend without --media-id or --scene", async () => {
    const sceneAutomation: SceneAutomation = {
      extendScene: vi.fn(),
      listScenes: vi.fn(async () => [])
    };
    const program = createProgram({ sceneAutomation });
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "gflow", "extend", "--prompt", "next scene"])
    ).rejects.toThrow();
    expect(sceneAutomation.extendScene).not.toHaveBeenCalled();
  });

  it("lists scenes through the scene automation", async () => {
    const sceneAutomation: SceneAutomation = {
      extendScene: vi.fn(),
      listScenes: vi.fn(async () => [{ id: "818777c1", name: "Untitled Scene 06-09" }])
    };
    const program = createProgram({ sceneAutomation });

    await program.parseAsync(["node", "gflow", "scene", "list", "--project", "Jun 05, 02:36 AM"]);

    expect(sceneAutomation.listScenes).toHaveBeenCalledWith("Jun 05, 02:36 AM");
  });

  it("passes --upscale and --character to the image job", async () => {
    let capturedJob: unknown;
    const automation: FlowAutomation = {
      runJob: vi.fn(async (input) => {
        capturedJob = input.job;
        return {
          jobId: input.job.id,
          artifacts: [],
          flowUrl: "https://labs.google/fx/tools/flow"
        };
      })
    };
    const program = createProgram({ automation });

    await program.parseAsync([
      "node",
      "gflow",
      "image",
      "--id",
      "x",
      "--prompt",
      "p",
      "--upscale",
      "2k",
      "--character",
      "Nyra"
    ]);

    expect(automation.runJob).toHaveBeenCalled();
    expect(capturedJob).toMatchObject({
      upscale: "2k",
      character: ["Nyra"]
    });
  });
});
