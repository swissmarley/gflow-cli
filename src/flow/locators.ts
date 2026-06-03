import type { Page } from "playwright";

export function flowLocators(page: Page) {
  return {
    promptBox: page.getByLabel("Prompt"),
    generateButton: page.getByRole("button", { name: /generate/i }),
    imageModeButton: page.getByRole("button", { name: /image/i }),
    videoModeButton: page.getByRole("button", { name: /video/i }),
    projectInput: page.getByLabel("Project"),
    modelInput: page.getByLabel("Model"),
    ratioInput: page.getByLabel("Aspect ratio"),
    durationInput: page.getByLabel("Duration"),
    outputCountInput: page.getByLabel("Outputs"),
    downloadLinks: page.getByRole("link", { name: /download/i }),
    loginMarker: page.getByTestId("flow-ready"),
    manualActionMarker: page.getByText(/manual action|sign in|verify|consent/i),
    rateLimitMarker: page.getByText(/too quickly|unusual activity|rate limit/i),
    creditMarker: page.getByText(/credit|quota/i),
    blockedMarker: page.getByText(/blocked|policy|cannot help/i),
    failedMarker: page.getByText(/failed|try again/i)
  };
}
