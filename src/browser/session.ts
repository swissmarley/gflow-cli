import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolveProfileDir } from "../config/paths.js";
import { FLOW_URL } from "../flow/page.js";

const execFileAsync = promisify(execFile);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Playwright's library default action timeout is 0 — i.e. wait forever. Flow's React/Radix
// menus occasionally leave a freshly opened option mid-animation or transiently covered, and an
// unbounded click then hangs indefinitely until the user nudges the page by hand (the reported
// "gflow video sticks on model selection" symptom). Bounding every action means a best-effort
// click that can't land fails fast and the run always proceeds instead of stalling.
export const DEFAULT_ACTION_TIMEOUT_MS = 20000;

function applyPageDefaults(page: Page): void {
  page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
}

export const BROWSER_CHANNELS = ["chrome", "chromium"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];
export const DEFAULT_BROWSER_CHANNEL: BrowserChannel = "chrome";
type BrowserLaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

export interface BrowserSessionOptions {
  profile: string;
  headed: boolean;
  browser: BrowserChannel;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

// Chrome writes SingletonLock/Cookie/Socket into the profile dir while running and
// removes them on a clean quit; a crash or force-kill leaves them behind.
const SINGLETON_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

export function isSingletonLockError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("ProcessSingleton") || error.message.includes("SingletonLock"));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process. EPERM = it exists but is owned by someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// SingletonLock is a symlink whose target is "<hostname>-<pid>". If that pid is no
// longer running, the lock is stale (Chrome was killed, not quit) and safe to clear.
// If the owning Chrome is still alive we return false and leave the lock untouched.
export async function clearStaleSingletonLock(profileDir: string): Promise<boolean> {
  const lockPath = join(profileDir, "SingletonLock");
  let target: string;
  try {
    if (!(await lstat(lockPath)).isSymbolicLink()) return false;
    target = await readlink(lockPath);
  } catch {
    return false;
  }

  const pid = Number.parseInt(target.slice(target.lastIndexOf("-") + 1), 10);
  if (Number.isNaN(pid) || isProcessAlive(pid)) return false;

  await Promise.all(SINGLETON_FILES.map((name) => rm(join(profileDir, name), { force: true })));
  return true;
}

// Find the root Chrome process(es) launched against this exact profile dir — i.e. the
// window `gflow auth login` opened. We match on the full --user-data-dir value (so the
// user's normal Chrome, which uses a different dir, is never touched) and skip helper
// processes (--type=...), which die with their parent.
export async function findChromeProcessesForProfile(profileDir: string): Promise<number[]> {
  if (process.platform === "win32") return [];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ps", ["-Ao", "pid=,command="], { maxBuffer: 16 * 1024 * 1024 }));
  } catch {
    return [];
  }

  const needle = `--user-data-dir=${profileDir}`;
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    if (!(line.includes(`${needle} `) || line.endsWith(needle))) continue;
    if (line.includes("--type=")) continue;
    const pid = Number.parseInt(line.trimStart(), 10);
    if (!Number.isNaN(pid) && pid !== process.pid) pids.push(pid);
  }
  return pids;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(150);
  }
  return !isProcessAlive(pid);
}

// Gracefully quit any Chrome holding this profile so Playwright can take it over.
// SIGTERM first so Chrome flushes session cookies to disk (important right after login);
// SIGKILL only as a last resort. Returns how many root processes were signalled.
export async function closeChromeForProfile(profileDir: string): Promise<number> {
  const pids = await findChromeProcessesForProfile(profileDir);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone between listing and killing — nothing to do.
    }
  }
  for (const pid of pids) {
    if (!(await waitForExit(pid, 8000))) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  return pids.length;
}

export function messageForBrowserLaunchError(error: unknown, browser: BrowserChannel, profileDir?: string): string | undefined {
  if (!(error instanceof Error)) return undefined;

  if (isSingletonLockError(error)) {
    return [
      `The gflow Chrome profile is already open${profileDir ? `: ${profileDir}` : "."}`,
      "Please quit the Chrome instance opened by `gflow auth login`, then run `gflow doctor` again.",
      "If you need to keep that window open, use a different profile name with both commands, for example `gflow auth login --profile clean` and `gflow doctor --profile clean`."
    ].join(" ");
  }

  if (browser !== "chrome" || !error.message.includes("Chromium distribution 'chrome' is not found")) return undefined;

  return [
    "Google Chrome is required for `--browser chrome`, which is the default for Google login.",
    "Install Google Chrome from https://www.google.com/chrome/ or with `brew install --cask google-chrome`, then run `gflow auth login` again.",
    "You can use `--browser chromium` for local fixture/testing flows, but Google sign-in may reject bundled Chromium as unsafe."
  ].join(" ");
}

export function buildBrowserLaunchOptions(options: BrowserSessionOptions): BrowserLaunchOptions {
  return {
    headless: !options.headed,
    acceptDownloads: true,
    channel: options.browser === "chrome" ? "chrome" : undefined,
    chromiumSandbox: options.browser === "chrome" ? true : undefined,
    // Hide the automation fingerprint that makes Google challenge an already signed-in
    // profile with a fresh 2FA/identity check. `--enable-automation` (a Playwright default)
    // sets navigator.webdriver and shows the "controlled by automated test software" banner;
    // dropping it plus AutomationControlled makes the session look like ordinary Chrome.
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"]
  };
}

// Path to the real Google Chrome binary. Driving the genuine Chrome over CDP (rather than
// a Playwright-spawned context) is what stops Google from challenging an already signed-in
// session with a fresh 2FA check. Override with GFLOW_CHROME_PATH if Chrome lives elsewhere.
export function resolveChromeExecutable(runtimePlatform: NodeJS.Platform = process.platform): string {
  const override = process.env.GFLOW_CHROME_PATH;
  if (override) return override;
  if (runtimePlatform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (runtimePlatform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "google-chrome";
}

// Chrome with --remote-debugging-port writes the chosen port to DevToolsActivePort in the
// profile dir (line 1 = port). It removes the file on a clean exit, so its presence plus a
// live process means a debuggable Chrome we can attach to.
async function readDevToolsPort(profileDir: string): Promise<number | undefined> {
  try {
    const contents = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
    const port = Number.parseInt(contents.split("\n")[0]?.trim() ?? "", 10);
    return Number.isNaN(port) ? undefined : port;
  } catch {
    return undefined;
  }
}

async function waitForDevToolsPort(profileDir: string, timeoutMs: number): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = await readDevToolsPort(profileDir);
    if (port) return port;
    await delay(150);
  }
  return undefined;
}

export interface ChromeLaunch {
  profileDir: string;
  port: number;
}

// A "headless" run still launches the REAL, full Chrome and drives it over CDP exactly like a
// headed run — Google already trusts that browser (it is what the profile signed in with) and
// will not re-challenge it. We only hide the window so nothing shows on the user's desktop.
// We deliberately avoid Chrome's own --headless=new: that is a separate engine Google can
// still fingerprint as insecure ("this browser or app may not be secure"), which is exactly
// the failure headed mode does not hit.
//
// These launch args are best-effort hints (they work on Windows/Linux); macOS ignores both
// the off-screen position (windows are clamped to the visible display) and --start-minimized
// for a directly spawned Chrome. applyWindowVisibility() is the authoritative enforcement:
// it minimizes the window over CDP as soon as the session attaches.
export function hiddenWindowArgs(headed: boolean): string[] {
  return headed ? [] : ["--window-position=-32000,-32000", "--window-size=1280,800", "--start-minimized"];
}

// Enforce the requested window visibility over CDP (Browser.setWindowBounds), which works on
// every platform including macOS where the launch-arg hints above are ignored. Headless runs
// minimize the window; headed runs restore it, so a Chrome left minimized by a previous
// --no-headed command becomes visible again when the user asks for --headed. Best-effort:
// a CDP hiccup here must never block the actual job.
async function applyWindowVisibility(page: Page, headed: boolean): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: headed ? "normal" : "minimized" }
      });
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    // Window control is cosmetic; never fail the session over it.
  }
}

// Launch a real Chrome bound to this profile with a debugging port and leave it running
// (detached) so later commands can reattach to the same trusted, logged-in window.
// --remote-allow-origins=* is required for Chrome >=111 to accept the CDP WebSocket.
export async function launchDebuggableChrome(profile: string, headed: boolean): Promise<ChromeLaunch> {
  const profileDir = resolveProfileDir(profile);
  await mkdir(profileDir, { recursive: true });
  await rm(join(profileDir, "DevToolsActivePort"), { force: true });

  const args = [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    // Keep navigator.webdriver false so the session looks like ordinary Chrome, matching the
    // automation fingerprint stripping in buildBrowserLaunchOptions.
    "--disable-blink-features=AutomationControlled",
    // Headless = same real Chrome over CDP as headed, just hidden off-screen (see above).
    ...hiddenWindowArgs(headed),
    FLOW_URL
  ];

  const child = spawn(resolveChromeExecutable(), args, { detached: true, stdio: "ignore" });
  child.unref();

  const port = await waitForDevToolsPort(profileDir, 30000);
  if (port === undefined) {
    throw new Error(
      [
        "Could not start Google Chrome with a debugging port.",
        `Tried: ${resolveChromeExecutable()}`,
        "Install Google Chrome (https://www.google.com/chrome/) or set GFLOW_CHROME_PATH to its executable, then try again."
      ].join(" ")
    );
  }
  return { profileDir, port };
}

// Launch a plain Chrome for interactive Google sign-in — deliberately WITHOUT
// --remote-debugging-port (and without --remote-allow-origins). Google's sign-in page blocks
// browsers with remote debugging enabled ("this browser or app may not be secure"), which is
// enforced on untrusted devices. Automation later reattaches to this same profile with a
// debugging port, by which point the session is signed in and never revisits the accounts
// sign-in page. Returns the profile directory.
export async function launchLoginChrome(profile: string): Promise<string> {
  const profileDir = resolveProfileDir(profile);
  await mkdir(profileDir, { recursive: true });
  // Clear any stale debug-port marker from a previous automation session so the next
  // automation command knows this plain window has no debugging port.
  await rm(join(profileDir, "DevToolsActivePort"), { force: true });

  const args = [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", FLOW_URL];
  const child = spawn(resolveChromeExecutable(), args, { detached: true, stdio: "ignore" });
  child.unref();
  return profileDir;
}

function pickFlowPage(context: BrowserContext): Page | undefined {
  return context.pages().find((page) => page.url().includes("labs.google"));
}

// Bundled-Chromium path, kept for local fixtures/tests (`--browser chromium`). Real Google
// sign-in rejects this, but it is handy for offline fixture flows.
async function openChromiumSession(options: BrowserSessionOptions, profileDir: string): Promise<BrowserSession> {
  const context = await chromium
    .launchPersistentContext(profileDir, buildBrowserLaunchOptions(options))
    .catch((error: unknown) => {
      throw new Error(messageForBrowserLaunchError(error, options.browser, profileDir) ?? (error instanceof Error ? error.message : String(error)));
    });
  const page = context.pages()[0] ?? (await context.newPage());
  applyPageDefaults(page);
  return {
    context,
    page,
    close: () => context.close()
  };
}

export async function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const profileDir = resolveProfileDir(options.profile);

  if (options.browser === "chromium") {
    return openChromiumSession(options, profileDir);
  }

  const connect = (port: number): Promise<Browser> => chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const running = await findChromeProcessesForProfile(profileDir);
  const existingPort = running.length > 0 ? await readDevToolsPort(profileDir) : undefined;

  let browser: Browser | undefined;

  // Reuse an automation (debug-port) Chrome from a previous command if one is reachable.
  if (existingPort !== undefined) {
    browser = await connect(existingPort).catch(() => undefined);
  }

  // Otherwise take the profile over with a debug-port Chrome. If a plain sign-in window is
  // holding the profile, close it first (its cookies are flushed on a graceful quit) so the
  // automation Chrome can open the same, now signed-in, profile.
  if (!browser) {
    if (running.length > 0) {
      console.error("gflow: handing the sign-in window over to an automation session…");
      await closeChromeForProfile(profileDir);
      await clearStaleSingletonLock(profileDir);
    }
    const launched = await launchDebuggableChrome(options.profile, options.headed);
    browser = await connect(launched.port).catch((error: unknown) => {
      throw new Error(
        [
          `Could not connect to the gflow Chrome session on port ${launched.port}.`,
          "Run `gflow auth login`, complete login, then run this command again.",
          error instanceof Error ? `(${error.message})` : ""
        ]
          .filter(Boolean)
          .join(" ")
      );
    });
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = pickFlowPage(context) ?? context.pages()[0] ?? (await context.newPage());
  applyPageDefaults(page);
  await applyWindowVisibility(page, options.headed);

  return {
    context,
    page,
    async close() {
      // Disconnect only — the user's Chrome (and its trusted, logged-in session) stays
      // open so the next command can reuse it without another sign-in or 2FA prompt.
      await browser.close();
    }
  };
}
