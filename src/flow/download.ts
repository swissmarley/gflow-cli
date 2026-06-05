import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import { GenerationFailedError, ManualActionRequiredError } from "../errors.js";

export type DownloadQuality = "original" | "2k" | "4k";

export function mediaIdFromSrc(src: string): string | undefined {
  const m = src.match(/[?&]name=([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

export function qualityMenuPattern(quality: DownloadQuality): RegExp {
  if (quality === "2k") return /2K/i;
  if (quality === "4k") return /4K/i;
  return /original/i;
}

export function extensionFor(type: "image" | "video", contentType: string | undefined): string {
  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("mp4") || contentType?.includes("video")) return ".mp4";
  return type === "video" ? ".mp4" : ".png";
}

export interface DownloadInput {
  page: Page;
  context: BrowserContext;
  src: string;
  type: "image" | "video";
  quality: DownloadQuality;
  outDir: string;
  basename: string; // e.g. "job1-001" (no extension)
}

export interface DownloadOutput {
  assetPath: string;
}

// Download a generated result at the requested quality. Prefer Flow's viewer Download
// menu (full native asset / upscales); fall back to fetching the inline src so the
// offline fixture and any future UI change still produce a file.
export async function downloadResult(input: DownloadInput): Promise<DownloadOutput> {
  await mkdir(input.outDir, { recursive: true });
  if (await openViewerForResult(input.page, input.src)) {
    const viaMenu = await downloadViaMenu(input);
    if (viaMenu) return viaMenu;
  }
  return fallbackFetch(input);
}

async function openViewerForResult(page: Page, src: string): Promise<boolean> {
  const found = await page.evaluate((s) => {
    const els = [...document.querySelectorAll("img,video")] as Array<HTMLImageElement | HTMLVideoElement>;
    const el = els.find((e) => ((e as HTMLVideoElement).currentSrc || e.src) === s);
    if (!el) return false;
    const clickable = (el.closest("a,button,[role=button]") as HTMLElement) || (el as HTMLElement);
    clickable.setAttribute("data-gflow-open", "1");
    return true;
  }, src);
  if (!found) return false;
  await page.locator('[data-gflow-open="1"]').first().click().catch(() => undefined);
  await page.evaluate(() => document.querySelector('[data-gflow-open="1"]')?.removeAttribute("data-gflow-open"));
  const dl = downloadButton(page);
  return dl.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
}

function downloadButton(page: Page): Locator {
  return page.locator('button[aria-haspopup="menu"]').filter({ hasText: /download/i }).first();
}

async function downloadViaMenu(input: DownloadInput): Promise<DownloadOutput | undefined> {
  const { page, quality, outDir, basename, type } = input;
  await downloadButton(page).click().catch(() => undefined);
  await page.waitForTimeout(500);

  const pattern = qualityMenuPattern(quality);
  const marked = await page.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const items = [...document.querySelectorAll("[role=menuitem],[role=menuitemradio],[role=option],[data-radix-collection-item]")];
      const el = items.find((e) => re.test((e.textContent || "").trim()));
      if (!el) return "none";
      if (/upgrade/i.test(el.textContent || "")) return "gated";
      el.setAttribute("data-gflow-dl", "1");
      return "ok";
    },
    { source: pattern.source, flags: pattern.flags }
  );
  if (marked === "gated") {
    throw new ManualActionRequiredError(
      "That download tier requires a Flow plan upgrade. Use --upscale 2k or omit --upscale."
    );
  }
  if (marked !== "ok") {
    await page.keyboard.press("Escape").catch(() => undefined);
    return undefined;
  }
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 180000 }),
    page.locator('[data-gflow-dl="1"]').first().click()
  ]);
  const ext = extname(download.suggestedFilename()) || (type === "video" ? ".mp4" : ".png");
  const assetPath = join(outDir, `${basename}${ext}`);
  await download.saveAs(assetPath);
  return { assetPath };
}

async function fallbackFetch(input: DownloadInput): Promise<DownloadOutput> {
  const { context, src, type, outDir, basename } = input;
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    const meta = src.slice(5, comma);
    const payload = src.slice(comma + 1);
    const bytes = meta.includes("base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    const assetPath = join(outDir, `${basename}${extensionFor(type, meta.split(";")[0])}`);
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, bytes);
    return { assetPath };
  }
  const response = await context.request.get(src);
  if (!response.ok()) throw new GenerationFailedError(`Failed to download a result (HTTP ${response.status()}).`);
  const contentType = response.headers()["content-type"];
  const assetPath = join(outDir, `${basename}${extensionFor(type, contentType)}`);
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, Buffer.from(await response.body()));
  return { assetPath };
}
