import { describe, expect, it } from "vitest";
import {
  CreditLimitError,
  DownloadError,
  GenerationBlockedError,
  GenerationFailedError,
  LoginRequiredError,
  ManualActionRequiredError,
  RateLimitedError,
  UiContractError,
  exitCodeForError,
  messageForError
} from "../src/errors.js";

describe("exitCodeForError", () => {
  it("maps local and UI errors to stable exit codes", () => {
    expect(exitCodeForError(new LoginRequiredError())).toBe(2);
    expect(exitCodeForError(new ManualActionRequiredError("Consent dialog"))).toBe(2);
    expect(exitCodeForError(new UiContractError("Prompt box"))).toBe(3);
    expect(exitCodeForError(new GenerationBlockedError("Policy block"))).toBe(4);
    expect(exitCodeForError(new RateLimitedError("Too fast"))).toBe(5);
    expect(exitCodeForError(new CreditLimitError("No credits"))).toBe(6);
    expect(exitCodeForError(new GenerationFailedError("Generation failed"))).toBe(7);
    expect(exitCodeForError(new DownloadError("Missing download"))).toBe(8);
    expect(exitCodeForError(new Error("Unknown"))).toBe(1);
  });
});

describe("messageForError", () => {
  it("returns actionable messages without stack traces", () => {
    const message = messageForError(new LoginRequiredError());
    expect(message).toContain("Run `gflow auth login`");
    expect(message).not.toContain("at ");
  });
});
