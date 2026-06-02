# Google Flow Browser CLI Design

Date: 2026-06-02

## Summary

Build a local CLI named `gflow` that automates Google Flow through a visible Playwright-controlled browser session. The first version focuses on repeatable image, video, and batch pipeline generation from the Flow web UI, using the user's own logged-in Google account and normal Flow controls.

The CLI will not use private API replay, hidden endpoint extraction, CAPTCHA bypassing, account spoofing, proxy rotation, watermark removal, or rate-limit circumvention. It should behave like a careful local assistant clicking through the UI, stopping when Flow asks for manual attention.

## Context

Google Flow currently presents image and video generation as a web product at `https://labs.google/fx/tools/flow`, not as a dedicated public CLI, MCP server, or Flow API. Flow Help documents prompt-box workflows for creating videos and images, including model selection, aspect ratio, output count, duration, ingredients, and start/end frames.

Official references checked during design:

- Flow video creation: https://support.google.com/flow/answer/16353334?hl=en
- Flow image creation and editing: https://support.google.com/flow/answer/16729550?hl=en
- Flow credit costs and rate-limit notes: https://support.google.com/flow/answer/16526234?hl=en
- Google Terms of Service: https://policies.google.com/terms

Flow Help also documents rate limiting, "Unusual Activity" messages, visible/invisible watermarks, credit costs per generation, and that costs can change. The CLI must treat these as runtime conditions, not problems to defeat.

## Goals

- Provide a command-line interface for local Flow generation.
- Support image generation, video generation, and YAML batch pipelines.
- Reuse a persistent local browser profile so the user logs in manually once.
- Download generated assets into a predictable output folder.
- Write metadata beside each downloaded asset for use in content-design pipelines.
- Fail clearly when Flow UI changes, login expires, generation is blocked, rate limits appear, or credits are insufficient.
- Keep the implementation modular so future providers can be added without changing the CLI surface.

## Non-Goals

- No hidden Google Flow endpoint automation.
- No scraping of private API calls or auth cookies.
- No CAPTCHA or login bypass.
- No attempt to evade Google limits or unusual-activity detection.
- No concurrent multi-account generation.
- No hosted SaaS mode.
- No guarantee that this remains stable if Flow changes its UI.

## CLI Surface

### `gflow auth login`

Opens a visible browser pointed at Flow. The user completes Google login manually. The CLI waits until it can detect a logged-in Flow screen, then stores no secrets beyond Playwright browser profile state on disk.

Options:

- `--profile <name>`: Browser profile name. Default: `default`.
- `--headed`: Always visible. Default for auth.

### `gflow doctor`

Checks the local environment and Flow readiness.

Checks:

- Node.js version.
- Playwright browser availability.
- Writable profile directory.
- Flow page reachable in the browser.
- Login state appears valid.
- Critical UI selectors can be found.

Exit codes:

- `0`: Ready.
- `1`: Local setup problem.
- `2`: Login or manual Flow action required.
- `3`: Flow UI contract changed.

### `gflow image`

Creates images through Flow's standard prompt box.

Example:

```bash
gflow image \
  --project "Summer Campaign" \
  --prompt "Minimal editorial product still on a warm studio background" \
  --model nano-banana-pro \
  --ratio 1:1 \
  --outputs 4 \
  --out ./outputs
```

Options:

- `--project <name>`: Existing or new Flow project.
- `--prompt <text>`: Required generation prompt.
- `--model <name>`: Flow-visible image model label.
- `--ratio <ratio>`: Flow-visible aspect ratio.
- `--outputs <n>`: Number of outputs requested.
- `--ingredient <path>`: Repeatable local media input, if supported by current UI.
- `--out <path>`: Output directory. Default: `./gflow-output`.
- `--timeout <seconds>`: Generation wait timeout. Default: 900.

### `gflow video`

Creates videos through Flow's standard prompt box.

Example:

```bash
gflow video \
  --project "Summer Campaign" \
  --prompt "A cinematic product reveal on a sunlit table, slow dolly in" \
  --model veo-3.1-fast \
  --duration 8 \
  --ratio 16:9 \
  --outputs 1 \
  --out ./outputs
```

Options:

- `--project <name>`: Existing or new Flow project.
- `--prompt <text>`: Required generation prompt.
- `--model <name>`: Flow-visible video model label.
- `--duration <seconds>`: Flow-visible duration.
- `--ratio <ratio>`: Flow-visible aspect ratio.
- `--outputs <n>`: Number of outputs requested.
- `--ingredient <path>`: Repeatable media reference input.
- `--start-frame <path>`: Local image for start frame, if supported by current UI.
- `--end-frame <path>`: Local image for end frame, if supported by current UI.
- `--out <path>`: Output directory. Default: `./gflow-output`.
- `--timeout <seconds>`: Generation wait timeout. Default: 1800.

### `gflow batch`

Runs a YAML pipeline serially. Serial execution is the default to respect Flow's credit and rate-limit behavior.

Example:

```yaml
jobs:
  - id: hero-video
    type: video
    project: Summer Campaign
    prompt: "A cinematic product reveal on a sunlit table, slow dolly in"
    model: veo-3.1-fast
    duration: 8
    ratio: "16:9"
    outputs: 1

  - id: concept-image
    type: image
    project: Summer Campaign
    prompt: "Minimal editorial product still on a warm studio background"
    model: nano-banana-pro
    ratio: "1:1"
    outputs: 4
```

Command:

```bash
gflow batch pipeline.yaml --out ./outputs
```

Batch behavior:

- Validate the YAML schema before starting.
- Run jobs in file order.
- Record per-job status in `gflow-run.json`.
- Stop on policy, login, unusual-activity, or credit-limit blocks.
- Continue on ordinary failed generations only when `--continue-on-failure` is provided.

## Architecture

The project will be a TypeScript Node.js CLI using Playwright.

Recommended package layout:

- `src/cli.ts`: Command registration and process exit mapping.
- `src/config/paths.ts`: Profile, cache, and output path resolution.
- `src/browser/session.ts`: Launches persistent Playwright contexts and opens Flow.
- `src/flow/locators.ts`: Centralized selector strategy for Flow UI.
- `src/flow/page.ts`: High-level Flow page operations such as open project, set mode, set prompt, generate, and download.
- `src/jobs/schema.ts`: Zod schemas for image, video, and batch job inputs.
- `src/jobs/runner.ts`: Serial job execution and status persistence.
- `src/output/artifacts.ts`: File naming, metadata writing, and download handling.
- `src/errors.ts`: Typed errors mapped to actionable CLI messages.
- `tests/`: Unit tests for schema, paths, runner behavior, and error mapping.

The selector layer is intentionally isolated. Flow UI changes should mostly require updates in `src/flow/locators.ts` and possibly `src/flow/page.ts`.

## Data Flow

1. CLI parses command arguments.
2. Command input is converted into an internal job object.
3. Job schema validates required fields and supported values.
4. Browser session launches with the selected persistent profile.
5. Flow page opens and verifies login state.
6. Flow project is selected or created.
7. Prompt mode and generation settings are applied.
8. Ingredients or frames are uploaded when requested and supported.
9. CLI clicks Generate.
10. Runner waits for new output tiles or known error states.
11. Outputs are downloaded to disk.
12. Metadata JSON is written next to each output.
13. Batch state is updated.

## Output Format

Each run writes to:

```text
<out>/
  gflow-run.json
  <job-id>/
    <job-id>-001.mp4
    <job-id>-001.json
    <job-id>-002.png
    <job-id>-002.json
```

Metadata fields:

- `jobId`
- `type`
- `prompt`
- `project`
- `model`
- `ratio`
- `duration`
- `requestedOutputs`
- `downloadedAt`
- `source`
- `flowUrl`
- `status`

## Error Handling

Typed errors:

- `LoginRequiredError`: Browser is not logged in or session expired.
- `ManualActionRequiredError`: CAPTCHA, 2FA, consent dialog, or Flow warning needs user action.
- `UiContractError`: Required selector or state was not found.
- `GenerationBlockedError`: Flow blocks the prompt by policy or account condition.
- `RateLimitedError`: Flow reports requests are too frequent or unusual activity.
- `CreditLimitError`: Flow reports insufficient or unavailable credits.
- `GenerationFailedError`: Flow reports a failed generation.
- `DownloadError`: Output tile found but download did not complete.

All errors should produce concise, actionable messages and nonzero exit codes. Batch mode records failed job status before exiting.

## Selector Strategy

Use resilient selectors in this order:

1. Accessible role and label selectors.
2. Visible text selectors for Flow-documented controls.
3. Stable input types and upload drop zones.
4. Narrow fallback CSS selectors only when unavoidable.

The CLI should include `gflow doctor` to detect selector drift quickly.

## Testing Strategy

Unit tests:

- CLI argument to job conversion.
- YAML schema validation.
- Output path and metadata generation.
- Batch stop/continue behavior.
- Error to exit-code mapping.

Integration tests:

- Playwright tests against a local static fixture that mimics the Flow UI contract.
- No real Google login or generation in automated tests.

Manual verification:

- `gflow auth login` with a real local profile.
- `gflow doctor` against Flow.
- One image generation.
- One video generation.
- One two-job batch run.

## Security and Privacy

- Browser state stays in a local profile directory.
- The CLI must not print cookies, auth headers, local storage values, or request payloads.
- Logs should redact local file paths only when explicitly configured; local paths are useful for pipeline debugging.
- The CLI should avoid collecting generated content beyond local metadata files.

## Future Extensions

- Official Gemini or Vertex provider behind the same job interface.
- MCP server wrapper around `gflow batch`.
- Prompt templating and variables for content-design pipelines.
- Collection and asset management if Flow exposes stable UI workflows.
- Optional headed-only record mode to regenerate selectors after Flow UI changes.

## Open Risks

- Flow UI changes can break automation.
- Login and consent flows are outside CLI control.
- Browser automation may trigger rate-limit or unusual-activity messages.
- Flow credit costs and model availability change over time.
- Download controls may differ by asset type, account tier, region, or browser state.

## Approval

The user approved the local Flow browser automation approach on 2026-06-02. Implementation may proceed after the written spec review gate is satisfied.
