import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { createProgram, resolveVersion } from "../src/cli.js";

function sub(program: Command, name: string): Command {
  const found = program.commands.find((c) => c.name() === name);
  if (!found) throw new Error(`command not found: ${name}`);
  return found;
}

describe("gflow help", () => {
  it("lists every top-level command with a description", () => {
    const help = createProgram().helpInformation();
    for (const name of ["auth", "doctor", "image", "video", "batch", "character", "tool", "agent"]) {
      expect(help).toContain(name);
    }
    // Each command line carries a description (not a bare `name [options]`).
    expect(help).toMatch(/doctor[\s\S]*?ready/i);
    expect(help).toMatch(/image[\s\S]*?Generate an image/i);
    expect(help).toMatch(/video[\s\S]*?Generate a video/i);
    expect(help).toMatch(/batch[\s\S]*?YAML pipeline/i);
  });

  it("exposes character/tool/agent subcommands in their help", () => {
    const program = createProgram();
    const characterHelp = sub(program, "character").helpInformation();
    expect(characterHelp).toMatch(/create/);
    expect(characterHelp).toMatch(/list/);

    const toolHelp = sub(program, "tool").helpInformation();
    expect(toolHelp).toMatch(/create/);
    expect(toolHelp).toMatch(/list/);
    expect(toolHelp).toMatch(/open/);

    const agentHelp = sub(program, "agent").helpInformation();
    expect(agentHelp).toContain("settings");
    expect(agentHelp).toContain("instruction");

    const instructionHelp = sub(sub(program, "agent"), "instruction").helpInformation();
    for (const name of ["add", "list", "clear"]) expect(instructionHelp).toContain(name);
  });

  it("reports the package.json version (no drift)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(resolveVersion()).toBe(pkg.version);
  });
});
