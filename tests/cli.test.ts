import { describe, expect, it, vi } from "vitest";
import type { FlowAutomation } from "../src/flow/types.js";
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
});
