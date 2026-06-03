export class GFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class LoginRequiredError extends GFlowError {
  constructor(message = "Google Flow login is required. Run `gflow auth login` and complete login in the browser.") {
    super("LOGIN_REQUIRED", message);
  }
}

export class ManualActionRequiredError extends GFlowError {
  constructor(message: string) {
    super("MANUAL_ACTION_REQUIRED", `Manual action required in the Flow browser: ${message}`);
  }
}

export class UiContractError extends GFlowError {
  constructor(message: string) {
    super("UI_CONTRACT_CHANGED", `Google Flow UI contract changed or could not be detected: ${message}`);
  }
}

export class GenerationBlockedError extends GFlowError {
  constructor(message: string) {
    super("GENERATION_BLOCKED", `Flow blocked this generation: ${message}`);
  }
}

export class RateLimitedError extends GFlowError {
  constructor(message: string) {
    super("RATE_LIMITED", `Flow reported rate limiting or unusual activity: ${message}`);
  }
}

export class CreditLimitError extends GFlowError {
  constructor(message: string) {
    super("CREDIT_LIMIT", `Flow reported a credit or quota problem: ${message}`);
  }
}

export class GenerationFailedError extends GFlowError {
  constructor(message: string) {
    super("GENERATION_FAILED", `Flow generation failed: ${message}`);
  }
}

export class DownloadError extends GFlowError {
  constructor(message: string) {
    super("DOWNLOAD_FAILED", `Generated output could not be downloaded: ${message}`);
  }
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof LoginRequiredError) return 2;
  if (error instanceof ManualActionRequiredError) return 2;
  if (error instanceof UiContractError) return 3;
  if (error instanceof GenerationBlockedError) return 4;
  if (error instanceof RateLimitedError) return 5;
  if (error instanceof CreditLimitError) return 6;
  if (error instanceof GenerationFailedError) return 7;
  if (error instanceof DownloadError) return 8;
  return 1;
}

export function messageForError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
