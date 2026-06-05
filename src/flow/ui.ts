import type { Locator, Page } from "playwright";

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
  await selectModelOption(page, model);
}

// Choose a model from an ALREADY-OPEN model menu (matches the option whose name equals
// `model` with punctuation/spacing stripped). Split out from pickModel so callers that
// open the dropdown themselves (e.g. a section-scoped Agent Settings dropdown) don't
// re-open and accidentally close it.
export async function selectModelOption(page: Page, model: string): Promise<void> {
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

export const FLOW_BASE = "https://labs.google/fx/tools/flow";
export type ProjectSub = "" | "characters" | "tools" | "create-tool";

export function projectIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/project\/([0-9a-f-]+)/i);
  return m ? m[1] : undefined;
}

export function projectSubUrl(projectId: string, sub: ProjectSub): string {
  return `${FLOW_BASE}/project/${projectId}${sub ? `/${sub}` : ""}`;
}

// Ensure the page is inside a project and return its id. When `projectName` is given,
// open that named project from the dashboard; otherwise use the project already open
// (or open/create one, matching FlowPage.ensureProject's older behavior).
export async function navigateToProject(page: Page, projectName?: string): Promise<string> {
  const current = projectIdFromUrl(page.url());
  if (!projectName && current) return current;

  if (projectName) {
    // The dashboard renders each project as a thumbnail <a href="…/project/<id>"> with the
    // name/timestamp in a sibling label (projects are named by timestamp unless renamed),
    // so match the card whose surrounding label contains the name and open it by href.
    await page.goto(FLOW_BASE, { waitUntil: "domcontentloaded" });
    await page.locator('a[href*="/project/"]').first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    const href = await page.evaluate((name) => {
      const linkSel = 'a[href*="/project/"]';
      for (const a of [...document.querySelectorAll(linkSel)]) {
        // Climb to the largest ancestor that still wraps exactly this one card (its label
        // sibling lives there), without reaching the grid that holds every card.
        let card: Element = a;
        while (card.parentElement && card.parentElement.querySelectorAll(linkSel).length === 1) {
          card = card.parentElement;
        }
        if ((card.textContent || "").includes(name)) return a.getAttribute("href");
      }
      return null;
    }, projectName);
    if (!href) throw new Error(`Could not find a Flow project matching "${projectName}".`);
    await page.goto(new URL(href, FLOW_BASE).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/project\/[0-9a-f-]+/i, { timeout: 20000 }).catch(() => undefined);
    const opened = projectIdFromUrl(page.url());
    if (!opened) throw new Error(`Could not open project "${projectName}".`);
    return opened;
  }

  // No name, not in a project: open/create the first project.
  const newProject = page.getByRole("button", { name: /new project/i }).first();
  if (await newProject.count()) {
    await newProject.click().catch(() => undefined);
    await page.waitForURL(/\/project\/[0-9a-f-]+/i, { timeout: 20000 }).catch(() => undefined);
  }
  const id = projectIdFromUrl(page.url());
  if (!id) throw new Error("No Flow project is open and one could not be created.");
  return id;
}

// Pick an option inside the block whose heading matches `sectionLabel` (Agent Settings
// renders identical Image/Video blocks, so global text matching is ambiguous).
export async function pickOptionInSection(page: Page, sectionLabel: RegExp, pattern: RegExp): Promise<boolean> {
  const marked = await page.evaluate(
    ({ sLabel, sFlags, pSource, pFlags }) => {
      const labelRe = new RegExp(sLabel, sFlags);
      const re = new RegExp(pSource, pFlags);
      const heading = [...document.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && labelRe.test((e.textContent || "").trim())
      );
      if (!heading) return false;
      const container = heading.closest("section,div,[role=group]");
      const section = (container && container.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]").length > 0)
        ? container
        : container?.parentElement ?? document.body;
      const el = [...section.querySelectorAll("button,[role=button],[role=radio],[role=menuitemradio],[role=option]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((b) => re.test((b.textContent || "").trim()));
      if (!el) return false;
      el.setAttribute("data-gflow-pick", "1");
      return true;
    },
    { sLabel: sectionLabel.source, sFlags: sectionLabel.flags, pSource: pattern.source, pFlags: pattern.flags }
  );
  if (!marked) return false;
  await page.locator('[data-gflow-pick="1"]').first().click().catch(() => undefined);
  await page.evaluate(() => document.querySelector('[data-gflow-pick="1"]')?.removeAttribute("data-gflow-pick"));
  await page.waitForTimeout(250);
  return true;
}

// Open the media picker via a trigger button (its text matches `triggerText`),
// upload a local file, wait for it to auto-select, then confirm with "Add to Prompt".
export async function uploadMedia(page: Page, triggerText: RegExp, filePath: string): Promise<void> {
  const trigger = page.locator("button").filter({ hasText: triggerText }).first();
  await trigger.click().catch(() => undefined);
  const dialog = page.locator("[role=dialog],[aria-modal=true]").first();
  await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);

  const uploadButton = dialog.locator("button").filter({ hasText: /upload/i }).first();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadButton.click()
  ]);
  await chooser.setFiles(filePath);

  const selected = dialog.locator('[role=option][aria-selected="true"]').first();
  await selected.waitFor({ state: "visible", timeout: 30000 }).catch(async () => {
    await dialog.locator("[role=option]").first().click().catch(() => undefined);
  });
  await confirmPicker(page, dialog);
}

// Open the media picker and pick an existing project asset whose label matches `name`.
// VERIFY LIVE (later): the picker's tab + asset tiles.
export async function addFromProject(page: Page, triggerText: RegExp, name: string): Promise<void> {
  const trigger = page.locator("button").filter({ hasText: triggerText }).first();
  await trigger.click().catch(() => undefined);
  const dialog = page.locator("[role=dialog],[aria-modal=true]").first();
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  const tile = dialog.getByText(name, { exact: true }).first();
  await tile.waitFor({ state: "visible", timeout: 15000 });
  await tile.click();
  await confirmPicker(page, dialog);
}

export async function confirmPicker(page: Page, dialog: Locator): Promise<void> {
  const confirm = dialog.locator("button").filter({ hasText: /add to (prompt|scene|character)/i }).first();
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
}
