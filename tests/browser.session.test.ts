import { mkdtemp, symlink, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBrowserLaunchOptions,
  clearStaleSingletonLock,
  closeChromeForProfile,
  findChromeProcessesForProfile,
  hiddenWindowArgs,
  isSingletonLockError,
  messageForBrowserLaunchError,
  resolveChromeExecutable
} from "../src/browser/session.js";

// lstat (not access) so we test for the symlink itself, not its dangling target.
async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false
  );
}

describe("buildBrowserLaunchOptions", () => {
  it("uses real Chrome with the normal Chromium sandbox enabled", () => {
    expect(buildBrowserLaunchOptions({ profile: "default", headed: true, browser: "chrome" })).toMatchObject({
      acceptDownloads: true,
      channel: "chrome",
      chromiumSandbox: true,
      headless: false
    });
  });

  it("keeps bundled Chromium as a fixture/testing fallback", () => {
    expect(buildBrowserLaunchOptions({ profile: "default", headed: false, browser: "chromium" })).toMatchObject({
      acceptDownloads: true,
      channel: undefined,
      chromiumSandbox: undefined,
      headless: true
    });
  });

  it("strips the automation fingerprint so Google does not re-challenge the session", () => {
    const options = buildBrowserLaunchOptions({ profile: "default", headed: true, browser: "chrome" });
    expect(options.ignoreDefaultArgs).toContain("--enable-automation");
    expect(options.args).toContain("--disable-blink-features=AutomationControlled");
  });
});

describe("hiddenWindowArgs", () => {
  it("adds no window flags for a headed run", () => {
    expect(hiddenWindowArgs(true)).toEqual([]);
  });

  it("hides the window off-screen for a headless run without using Chrome's headless engine", () => {
    const args = hiddenWindowArgs(false);
    expect(args).toContain("--window-position=-32000,-32000");
    expect(args.some((a) => a.startsWith("--start-minimized"))).toBe(true);
    // The whole point: never fall back to --headless=new, which Google can still flag as insecure.
    expect(args.some((a) => a.includes("headless"))).toBe(false);
  });
});

describe("messageForBrowserLaunchError", () => {
  it("explains how to fix a missing Chrome channel", () => {
    const message = messageForBrowserLaunchError(
      new Error("browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app"),
      "chrome"
    );

    expect(message).toContain("Google Chrome is required");
    expect(message).toContain("brew install --cask google-chrome");
    expect(message).toContain("--browser chromium");
  });

  it("explains that an already-open gflow Chrome profile must be quit", () => {
    const message = messageForBrowserLaunchError(
      new Error(
        [
          "browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory.",
          "Failed to create /project/.gflow/profiles/default/SingletonLock: File exists (17)"
        ].join("\n")
      ),
      "chrome",
      "/project/.gflow/profiles/default"
    );

    expect(message).toContain("gflow Chrome profile is already open");
    expect(message).toContain("quit the Chrome instance opened by `gflow auth login`");
    expect(message).toContain("/project/.gflow/profiles/default");
  });

  it("does not rewrite unrelated browser errors", () => {
    expect(messageForBrowserLaunchError(new Error("Other failure"), "chrome")).toBeUndefined();
    expect(messageForBrowserLaunchError(new Error("Chromium distribution 'chrome' is not found"), "chromium")).toBeUndefined();
  });
});

describe("isSingletonLockError", () => {
  it("recognises ProcessSingleton and SingletonLock failures", () => {
    expect(isSingletonLockError(new Error("Failed to create a ProcessSingleton for your profile directory."))).toBe(true);
    expect(isSingletonLockError(new Error("Failed to create .../SingletonLock: File exists (17)"))).toBe(true);
    expect(isSingletonLockError(new Error("Some other failure"))).toBe(false);
    expect(isSingletonLockError("not an error")).toBe(false);
  });
});

describe("clearStaleSingletonLock", () => {
  it("removes a lock whose owning process is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gflow-lock-"));
    const lockPath = join(dir, "SingletonLock");
    await writeFile(join(dir, "SingletonCookie"), "");
    // pid 1 belongs to launchd/init; "host-2147483646" points at a pid that cannot exist.
    await symlink("some-host-2147483646", lockPath);

    expect(await clearStaleSingletonLock(dir)).toBe(true);
    expect(await exists(lockPath)).toBe(false);
    expect(await exists(join(dir, "SingletonCookie"))).toBe(false);
  });

  it("leaves a lock held by a live process untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gflow-lock-"));
    const lockPath = join(dir, "SingletonLock");
    await symlink(`some-host-${process.pid}`, lockPath);

    expect(await clearStaleSingletonLock(dir)).toBe(false);
    expect(await exists(lockPath)).toBe(true);
  });

  it("does nothing when there is no lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gflow-lock-"));
    expect(await clearStaleSingletonLock(dir)).toBe(false);
  });
});

describe("resolveChromeExecutable", () => {
  it("resolves the real Chrome binary per platform", () => {
    expect(resolveChromeExecutable("darwin")).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(resolveChromeExecutable("win32")).toContain("chrome.exe");
    expect(resolveChromeExecutable("linux")).toBe("google-chrome");
  });

  it("honours the GFLOW_CHROME_PATH override", () => {
    const previous = process.env.GFLOW_CHROME_PATH;
    process.env.GFLOW_CHROME_PATH = "/custom/chrome";
    try {
      expect(resolveChromeExecutable("darwin")).toBe("/custom/chrome");
    } finally {
      if (previous === undefined) delete process.env.GFLOW_CHROME_PATH;
      else process.env.GFLOW_CHROME_PATH = previous;
    }
  });
});

describe("findChromeProcessesForProfile", () => {
  it("returns no processes for a profile dir nothing is using", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gflow-noproc-"));
    expect(await findChromeProcessesForProfile(dir)).toEqual([]);
  });

  it("treats a profile with no live Chrome as nothing to close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gflow-noproc-"));
    expect(await closeChromeForProfile(dir)).toBe(0);
  });
});
