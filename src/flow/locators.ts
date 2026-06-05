import type { Page } from "playwright";

export function flowLocators(page: Page) {
  return {
    // The Flow prompt is a contenteditable div (role=textbox), placeholder
    // "What do you want to create?" — not a labeled <textarea>.
    promptBox: page.locator('[role="textbox"][contenteditable="true"]'),
    // Signed-in Flow dashboard/landing (projects view). Proves an authenticated session
    // for `doctor`; the prompt box only exists once a project is open.
    dashboardMarker: page.getByRole("button", { name: /new project/i }),
    newProjectButton: page.getByRole("button", { name: /new project/i }),
    // Submit button: "Create" carrying the arrow_forward icon (disabled until the prompt
    // has text). The sibling "add_2 Create" button is a different control.
    submitButton: page.locator("button", { hasText: "Create" }).filter({ hasText: /arrow_forward/ }),
    // The model/settings pill (e.g. "🍌 Nano Banana 2 / crop_16_9 / x2") opens the popover
    // with Image/Video mode, aspect ratio, output count and model.
    settingsButton: page.locator("button").filter({ hasText: /crop_(16_9|9_16|square|portrait|landscape)/ }),
    rateLimitMarker: page.getByText(/unusual activity|trying again too|rate limit/i),
    creditMarker: page.getByText(/run out of credits|insufficient credits|no credits left/i),
    blockedMarker: page.getByText(/can.?t help with|violates|content policy/i),
    failedMarker: page.getByText(/generation failed|couldn.?t generate|something went wrong/i),
    manualActionMarker: page.getByText(/verify your identity|sign in to continue|consent required/i),
    characterPrompt: page.locator('[role="textbox"][contenteditable="true"]'),
    characterCreateButton: page.locator("button").filter({ hasText: /arrow_forward/ }).filter({ hasText: /create/i }),
    characterUploadButton: page.locator("button").filter({ hasText: /^upload/i }),
    characterAddFromProject: page.locator("button").filter({ hasText: /add from project/i })
  };
}
