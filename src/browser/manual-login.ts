import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { platform } from "node:os";
import { resolveProfileDir } from "../config/paths.js";
import { FLOW_URL } from "../flow/page.js";

export interface ManualChromeLoginOptions {
  profile: string;
  url?: string;
}

export interface ManualChromeLaunchPlan {
  command: string;
  args: string[];
  profileDir: string;
  url: string;
}

function chromeArgs(profileDir: string, url: string): string[] {
  return [`--user-data-dir=${profileDir}`, "--no-first-run", "--new-window", url];
}

export function buildManualChromeLaunchPlan(options: ManualChromeLoginOptions, runtimePlatform = platform()): ManualChromeLaunchPlan {
  const profileDir = resolveProfileDir(options.profile);
  const url = options.url ?? FLOW_URL;
  const args = chromeArgs(profileDir, url);

  if (runtimePlatform === "darwin") {
    return {
      command: "open",
      args: ["-na", "Google Chrome", "--args", ...args],
      profileDir,
      url
    };
  }

  if (runtimePlatform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", "chrome", ...args],
      profileDir,
      url
    };
  }

  return {
    command: "google-chrome",
    args,
    profileDir,
    url
  };
}

export async function openManualChromeLogin(options: ManualChromeLoginOptions): Promise<ManualChromeLaunchPlan> {
  const plan = buildManualChromeLaunchPlan(options);
  await mkdir(plan.profileDir, { recursive: true });

  const child = spawn(plan.command, plan.args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return plan;
}
