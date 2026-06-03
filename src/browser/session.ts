import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveProfileDir } from "../config/paths.js";

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

export function messageForBrowserLaunchError(error: unknown, browser: BrowserChannel): string | undefined {
  if (!(error instanceof Error)) return undefined;
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
    chromiumSandbox: options.browser === "chrome" ? true : undefined
  };
}

export async function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(resolveProfileDir(options.profile), buildBrowserLaunchOptions(options));
  } catch (error) {
    throw new Error(messageForBrowserLaunchError(error, options.browser) ?? (error instanceof Error ? error.message : String(error)));
  }
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    async close() {
      await context.close();
    }
  };
}
