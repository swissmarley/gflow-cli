import type { Page } from "playwright";

// Mark the visible control whose trimmed text matches `pattern`, then real-click it.
// Flow's controls live in React/Radix portals and ignore synthetic DOM .click(); a
// trusted Playwright click on the marked element is honored.
export async function pickOption(page: Page, pattern: RegExp): Promise<boolean> {
  const marked = await page.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const el = [...document.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((b) => re.test((b.textContent || "").trim()));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    { source: pattern.source, flags: pattern.flags }
  );
  if (!marked) return false;
  await page.locator('[data-gflow-pick="1"]').first().click().catch(() => undefined);
  await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
  await page.waitForTimeout(250);
  return true;
}

// Open a model dropdown (arrow_drop_down) and pick the option whose name matches
// `model` with punctuation/spacing stripped, so "nano-banana-pro" matches "Nano Banana Pro".
export async function pickModel(page: Page, model: string): Promise<void> {
  if (!(await pickOption(page, /arrow_drop_down/))) return;
  await page.waitForTimeout(700);
  const target = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  const marked = await page.evaluate((t) => {
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const el = [...document.querySelectorAll("[role=option],[role=menuitem],[role=menuitemradio],button,li")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .find((e) => t.length > 2 && norm(e.textContent).includes(t));
    if (!el) return false;
    el.setAttribute("data-gflow-pick", "1");
    return true;
  }, target);
  if (marked) {
    await page.locator('[data-gflow-pick="1"]').first().click().catch(() => undefined);
    await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await page.waitForTimeout(300);
}
