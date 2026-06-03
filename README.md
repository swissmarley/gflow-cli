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

This opens a normal Google Chrome window with an isolated `gflow` profile. Complete Google login there, close that Chrome window, then run `doctor`. Browser profile state is stored in `.gflow/profiles/default`.

Login intentionally runs outside Playwright because Google may reject automation-controlled login pages with "This browser or app may not be secure." If Chrome is not installed, install it first:

```bash
brew install --cask google-chrome
```

or download it from https://www.google.com/chrome/.

For fixture testing or diagnostics, you can still force the older Playwright login path, but Google sign-in may reject it:

```bash
npm run dev -- auth login --playwright --browser chromium
```

If Chrome shows an unsupported `--no-sandbox` banner, you are using a Playwright-controlled login path or an older build. Use plain `npm run dev -- auth login` for manual login.

## Doctor

```bash
npm run dev -- doctor
```

`doctor` checks whether Flow opens, the profile appears logged in, and the expected UI controls are visible.

Use the same browser channel for `doctor`, `image`, `video`, and `batch` that you used for login. The default is `chrome`.

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
