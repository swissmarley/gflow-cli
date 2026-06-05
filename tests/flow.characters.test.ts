import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { CharacterPage } from "../src/flow/characters.js";

describe("CharacterPage", () => {
  it("lists saved character cards from the project media view", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.route("**/fx/tools/flow/project/abc", async (route) => {
        await route.fulfill({
          contentType: "text/html",
          body: `
            <button>accessibility_new Characters</button>
            <div role="button">
              <a href="/fx/tools/flow/project/abc/character/char-1">
                <span>accessibility_new</span>
                <img alt="Untitled Character" src="https://example.test/thumb.png">
              </a>
              <span>Untitled Character</span>
            </div>
          `
        });
      });
      await page.route("**/fx/tools/flow/project/abc/characters", async (route) => {
        await route.fulfill({
          contentType: "text/html",
          body: `
            <h1>New character</h1>
            <div role="textbox" contenteditable="true">Describe your character...</div>
          `
        });
      });

      await page.goto("https://labs.google/fx/tools/flow/project/abc");
      const characters = await new CharacterPage(page).listCharacters();

      expect(characters).toEqual([
        {
          name: "Untitled Character",
          thumbnailUrl: "https://example.test/thumb.png"
        }
      ]);
    } finally {
      await browser.close();
    }
  });
});
