import { describe, expect, it } from "vitest";
import { buildManualChromeLaunchPlan } from "../src/browser/manual-login.js";

describe("buildManualChromeLaunchPlan", () => {
  it("opens macOS Google Chrome outside Playwright with the gflow profile", () => {
    const plan = buildManualChromeLaunchPlan({ profile: "default", url: "https://example.test/flow" }, "darwin");

    expect(plan.command).toBe("open");
    expect(plan.args).toEqual([
      "-na",
      "Google Chrome",
      "--args",
      expect.stringContaining("--user-data-dir="),
      "--no-first-run",
      "--new-window",
      "https://example.test/flow"
    ]);
    expect(plan.profileDir).toContain(".gflow/profiles/default");
  });

  it("builds a direct chrome command for Linux", () => {
    const plan = buildManualChromeLaunchPlan({ profile: "work" }, "linux");

    expect(plan.command).toBe("google-chrome");
    expect(plan.args).toContain("--no-first-run");
    expect(plan.args).toContain("--new-window");
    expect(plan.url).toBe("https://labs.google/fx/tools/flow");
  });
});
