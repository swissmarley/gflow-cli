# gflow

`gflow` is a local CLI for driving Google Flow through a visible Playwright browser session. It uses your own logged-in Flow account and normal Flow UI controls.

## Boundaries

`gflow` does not replay private Google APIs, bypass login, solve CAPTCHA, rotate accounts, strip watermarks, or evade Flow rate limits. If Flow asks for manual action, the CLI stops and tells you what to do.

## Install

```bash
npm install
npm run build
npx playwright install chromium
```

If your global npm cache has permission issues, use a project-local cache:

```bash
npm install --cache ./.npm-cache
```

## Login

```bash
npm run dev -- auth login
```

Complete Google login in the browser. Browser profile state is stored in `.gflow/profiles/default`.

## Doctor

```bash
npm run dev -- doctor
```

`doctor` checks whether Flow opens, the profile appears logged in, and the expected UI controls are visible.

## Image

```bash
npm run dev -- image \
  --id concept-image \
  --project "Summer Campaign" \
  --prompt "Minimal editorial product still on a warm studio background" \
  --model nano-banana-pro \
  --ratio 1:1 \
  --outputs 1 \
  --out ./gflow-output
```

Use `--no-headed` if you want the browser to run headless after the profile is already logged in.

## Video

```bash
npm run dev -- video \
  --id hero-video \
  --project "Summer Campaign" \
  --prompt "A cinematic product reveal on a sunlit table, slow dolly in" \
  --model veo-3.1-fast \
  --duration 8 \
  --ratio 16:9 \
  --outputs 1 \
  --out ./gflow-output
```

## Batch

```bash
npm run dev -- batch examples/pipeline.yaml --out ./gflow-output
```

Outputs are written as:

```text
gflow-output/
  gflow-run.json
  <job-id>/
    <job-id>-001.png
    <job-id>-001.json
```

Batch jobs run serially. Login prompts, manual verification, rate limits, credit issues, and policy blocks stop the run.
