import type { Page } from "playwright";
import { GenerationBlockedError } from "../errors.js";
import type { CreateToolInput, ToolAutomation, ToolResult, ToolSummary } from "./types.js";
import { navigateToProject, projectSubUrl } from "./ui.js";

const TOOL_PRESET_LABEL: Record<NonNullable<CreateToolInput["preset"]>, RegExp> = {
  "image-filter": /Image Filter/i,
  "style-morph": /Style Morph/i,
  "time-stretcher": /Time Stretcher/i,
  "voice-over": /Voice Over/i
};

export class ToolPage implements ToolAutomation {
  constructor(private readonly page: Page) {}

  async createTool(input: CreateToolInput): Promise<ToolResult> {
    const projectId = await navigateToProject(this.page, input.project);
    await this.page.goto(projectSubUrl(projectId, "create-tool"), { waitUntil: "domcontentloaded" });
    const prompt = this.page.locator('[role="textbox"][contenteditable="true"]').first();
    await prompt.waitFor({ state: "visible", timeout: 20000 });

    if (input.preset) {
      await this.page.getByText(TOOL_PRESET_LABEL[input.preset]).first().click().catch(() => undefined);
      await this.page.waitForTimeout(300);
    }
    await prompt.click();
    await prompt.pressSequentially(input.prompt, { delay: 8 });

    if (await this.page.getByText(/can.?t help with|violates|content policy/i).first().isVisible().catch(() => false)) {
      throw new GenerationBlockedError("Flow blocked this tool description.");
    }

    const create = this.page.locator("button").filter({ hasText: /arrow_forward/ }).filter({ hasText: /create/i }).first();
    await create.click();
    // Building an applet can take a while; it ends by navigating into the tool.
    await this.page.waitForURL(/\/(tool|tools)\//i, { timeout: 180000 }).catch(() => undefined);
    return { name: input.name ?? input.prompt.slice(0, 32), flowUrl: this.page.url() };
  }

  async listTools(project?: string): Promise<ToolSummary[]> {
    const projectId = await navigateToProject(this.page, project);
    await this.page.goto(projectSubUrl(projectId, "tools"), { waitUntil: "domcontentloaded" });
    await this.page.getByRole("tab", { name: /my tools/i }).first().click().catch(() => undefined);
    await this.page.waitForTimeout(1200);
    // Each tool card holds a "Tool options" button; the name is a leaf <span> in the card's
    // title block (a sibling "by <author>" span follows). Climb from each options button to
    // the nearest ancestor that carries a plausible name span. (Classes are hashed, so we
    // match by structure/text, not class names.)
    return this.page.evaluate(() => {
      const names = new Set<string>();
      for (const btn of [...document.querySelectorAll("button")]) {
        if (!/tool options/i.test(btn.textContent || "")) continue;
        let card: Element | null = btn.parentElement;
        for (let i = 0; i < 6 && card; i += 1, card = card.parentElement) {
          const span = [...card.querySelectorAll("span")].find((s) => {
            const t = (s.textContent || "").trim();
            return s.children.length === 0 && t.length > 0 && !/^by /i.test(t) && !/tool options/i.test(t);
          });
          if (span) {
            names.add((span.textContent || "").trim());
            break;
          }
        }
      }
      return [...names].map((name) => ({ name }));
    });
  }

  async openTool(name: string, project?: string): Promise<void> {
    await this.listTools(project); // navigates to /tools, My Tools tab
    const card = this.page.getByText(name, { exact: true }).first();
    await card.waitFor({ state: "visible", timeout: 15000 });
    await card.click();
    await this.page.waitForTimeout(1500);
  }
}
