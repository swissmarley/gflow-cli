import { describe, expect, it } from "vitest";
import { buildBrowserLaunchOptions, messageForBrowserLaunchError } from "../src/browser/session.js";

describe("buildBrowserLaunchOptions", () => {
  it("uses real Chrome with the normal Chromium sandbox enabled", () => {
    expect(buildBrowserLaunchOptions({ profile: "default", headed: true, browser: "chrome" })).toMatchObject({
      acceptDownloads: true,
      channel: "chrome",
      chromiumSandbox: true,
      headless: false
    });
  });

  it("keeps bundled Chromium as a fixture/testing fallback", () => {
    expect(buildBrowserLaunchOptions({ profile: "default", headed: false, browser: "chromium" })).toMatchObject({
      acceptDownloads: true,
      channel: undefined,
      chromiumSandbox: undefined,
      headless: true
    });
  });
});

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
