import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveProfileDir } from "../config/paths.js";

export interface BrowserSessionOptions {
  profile: string;
  headed: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(resolveProfileDir(options.profile), {
    headless: !options.headed,
    acceptDownloads: true
  });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    async close() {
      await context.close();
    }
  };
}
