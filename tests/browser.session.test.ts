import { describe, expect, it } from "vitest";
import { messageForBrowserLaunchError } from "../src/browser/session.js";

describe("messageForBrowserLaunchError", () => {
  it("explains how to fix a missing Chrome channel", () => {
    const message = messageForBrowserLaunchError(
      new Error("browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app"),
      "chrome"
    );

    expect(message).toContain("Google Chrome is required");
    expect(message).toContain("brew install --cask google-chrome");
    expect(message).toContain("--browser chromium");
  });

  it("does not rewrite unrelated browser errors", () => {
    expect(messageForBrowserLaunchError(new Error("Other failure"), "chrome")).toBeUndefined();
    expect(messageForBrowserLaunchError(new Error("Chromium distribution 'chrome' is not found"), "chromium")).toBeUndefined();
  });
});
