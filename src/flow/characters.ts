import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { GenerationBlockedError, GenerationFailedError } from "../errors.js";
import type { CharacterAutomation, CharacterResult, CharacterSummary, CreateCharacterInput } from "./types.js";
import { addFromProject, navigateToProject, pickModel, projectSubUrl, uploadMedia } from "./ui.js";
import { flowLocators } from "./locators.js";

const PRESET_LABEL: Record<NonNullable<CreateCharacterInput["preset"]>, RegExp> = {
  familiar: /The Familiar/i,
  eccentric: /The Eccentric/i,
  wicked: /The Wicked/i,
  fantastical: /The Fantastical/i
};

export class CharacterPage implements CharacterAutomation {
  constructor(private readonly page: Page) {}

  async createCharacter(input: CreateCharacterInput): Promise<CharacterResult> {
    const projectId = await navigateToProject(this.page, input.project);
    await this.page.goto(projectSubUrl(projectId, "characters"), { waitUntil: "domcontentloaded" });
    const locators = flowLocators(this.page);
    await locators.characterPrompt.first().waitFor({ state: "visible", timeout: 20000 });

    if (input.preset) {
      await this.page.getByText(PRESET_LABEL[input.preset]).first().click().catch(() => undefined);
      await this.page.waitForTimeout(300);
    }
    if (input.model) await pickModel(this.page, input.model);

    for (const file of input.images) await uploadMedia(this.page, /^upload/i, file);
    for (const ref of input.fromProject) await addFromProject(this.page, /add from project/i, ref);

    const box = locators.characterPrompt.first();
    await box.click();
    await box.press("ControlOrMeta+a").catch(() => undefined);
    await box.press("Backspace").catch(() => undefined);
    await box.pressSequentially(input.prompt, { delay: 8 });

    await this.assertNotBlocked();
    const before = new Set(await this.characterThumbs());
    await locators.characterCreateButton.first().click();

    const added = await this.waitForNewCharacter(before, (input.timeout ?? 600) * 1000);

    await this.configureCharacter(input);

    let thumbnailPath: string | undefined;
    if (added) {
      thumbnailPath = await this.saveThumb(this.page.context(), added, input.outDir, input.name);
    }
    return { name: input.name, thumbnailPath, flowUrl: this.page.url() };
  }

  async listCharacters(project?: string): Promise<CharacterSummary[]> {
    const projectId = await navigateToProject(this.page, project);
    await this.page.goto(projectSubUrl(projectId, ""), { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(800);
    await this.page.locator("button").filter({ hasText: /Characters/i }).first().click().catch(() => undefined);
    await this.page.waitForTimeout(800);
    return this.page.evaluate(() => {
      const results: Array<{ name: string; thumbnailUrl?: string }> = [];
      const seen = new Set<string>();

      for (const link of [...document.querySelectorAll('a[href*="/character/"]')]) {
        const img = link.querySelector("img") as HTMLImageElement | null;
        const thumbnailUrl = img?.currentSrc || img?.src || undefined;
        const alt = img?.alt?.trim();
        const cardText = (
          link.closest("[role=button],article,figure,li,div")?.textContent ||
          link.textContent ||
          ""
        )
          .replace(/accessibility_new/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const name = alt && !/generated image|user profile image/i.test(alt) ? alt : cardText;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        results.push(thumbnailUrl !== undefined && thumbnailUrl !== "" ? { name, thumbnailUrl } : { name });
      }

      if (results.length > 0) return results;

      const tiles = [...document.querySelectorAll("[data-character-id],[role=listitem],figure")];
      for (const t of tiles) {
        const name = (t.querySelector("figcaption,[class*=name],h3,h4")?.textContent || "").trim();
        if (!name) continue;
        const img = t.querySelector("img") as HTMLImageElement | null;
        const thumbnailUrl = img?.currentSrc || img?.src || undefined;
        results.push(thumbnailUrl !== undefined && thumbnailUrl !== "" ? { name, thumbnailUrl } : { name });
      }
      return results;
    });
  }

  private async configureCharacter(input: CreateCharacterInput): Promise<void> {
    // After generation, the character detail page shows: an <input placeholder="Character Name">,
    // "Select a voice" button, description <textarea>, and a "Done" button.
    const nameInput = this.page.locator('input[placeholder="Character Name"]').first();
    await nameInput.waitFor({ state: "visible", timeout: 30000 }).catch(() => undefined);
    await this.page.waitForTimeout(500);

    // Set the character name via the input field
    if (await nameInput.count()) {
      await nameInput.click();
      await nameInput.fill(input.name);
      await this.page.waitForTimeout(200);
    }

    // Select a voice if specified. The voice picker shows [role=option] items
    // with names like "Zephyr" and a confirm button "Add to Character".
    if (input.voice) {
      const voiceBtn = this.page.locator("button").filter({ hasText: /Select a voice/i }).first();
      if (await voiceBtn.count()) {
        await voiceBtn.click();
        await this.page.waitForTimeout(800);
        const voiceOption = this.page.locator("[role=option]").filter({ hasText: input.voice }).first();
        await voiceOption.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
        await voiceOption.click().catch(() => undefined);
        await this.page.waitForTimeout(300);
        const addBtn = this.page.locator("button").filter({ hasText: /Add to Character/i }).first();
        await addBtn.click().catch(() => undefined);
        await this.page.waitForTimeout(500);
      }
    }

    // Fill in character description if provided
    if (input.description) {
      const descField = this.page.locator('textarea[placeholder="Describe how your character acts..."]').first();
      if (await descField.count()) {
        await descField.click();
        await descField.fill(input.description);
        await this.page.waitForTimeout(200);
      }
    }

    // Click "Done" to save the character configuration
    const doneBtn = this.page.locator("button").filter({ hasText: /^Done$/i }).first();
    if (await doneBtn.count()) {
      await doneBtn.click();
      await this.page.waitForTimeout(500);
    }
  }

  private async characterThumbs(): Promise<string[]> {
    return this.page.$$eval("img", (imgs) =>
      imgs.map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src).filter((s) => /getMediaUrlRedirect/.test(s))
    );
  }

  private async waitForNewCharacter(before: Set<string>, timeoutMs: number): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    const locators = flowLocators(this.page);
    while (Date.now() < deadline) {
      if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationBlockedError("Flow blocked the character generation (content policy).");
      }
      if (await locators.failedMarker.first().isVisible().catch(() => false)) {
        throw new GenerationFailedError("Flow reported the character generation failed.");
      }
      const added = (await this.characterThumbs()).filter((s) => !before.has(s));
      if (added.length > 0) return added[0];
      await this.page.waitForTimeout(1500);
    }
    return undefined;
  }

  private async assertNotBlocked(): Promise<void> {
    const locators = flowLocators(this.page);
    if (await locators.blockedMarker.first().isVisible().catch(() => false)) {
      throw new GenerationBlockedError("Flow blocked this character prompt.");
    }
  }

  private async saveThumb(context: BrowserContext, src: string, outDir: string, name: string): Promise<string | undefined> {
    try {
      const response = await context.request.get(src);
      if (!response.ok()) return undefined;
      await mkdir(outDir, { recursive: true });
      const path = join(outDir, `character-${name.replace(/[^a-zA-Z0-9._-]+/g, "_")}.png`);
      await writeFile(path, Buffer.from(await response.body()));
      return path;
    } catch {
      return undefined;
    }
  }
}
