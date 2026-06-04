<div align="center">

# gflow

**Generate images and videos with [Google Flow](https://labs.google/fx/tools/flow) from your terminal.**

`gflow` drives Flow inside your own logged-in Google Chrome, so it works as a normal, human
browser session — no private APIs, no login bypass.

[![CI](https://github.com/swissmarley/gflow-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/swissmarley/gflow-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@swissmarley/gflow-cli)](https://www.npmjs.com/package/@swissmarley/gflow-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

</div>

---

## Features

- 🖼️ **Image generation** — Nano Banana 2 / Pro, Imagen 4
- 🎬 **Video generation** — Omni Flash, Veo 3.1 (Lite / Fast / Quality)
- 🎞️ **Frames mode** — animate between a first and last frame image
- 🎛️ **Full control** — model, aspect ratio, duration, output count
- 📦 **Batch pipelines** — run many jobs from a YAML file
- 🔒 **Your session** — attaches to the Chrome you log into; nothing is stored beyond the
  browser profile on your disk

## How it works

`gflow` never spawns a hidden automation browser (Google challenges those with repeated 2FA).
Instead:

1. `gflow auth login` launches a **real Google Chrome** with a debugging port and leaves it open.
2. You sign in once (including any 2FA) in that window.
3. Every other command attaches to that exact window over the Chrome DevTools Protocol
   (`connectOverCDP`), drives Flow's normal UI, and downloads results through Flow's own
   authenticated media URLs.

## Requirements

- **Node.js >= 20**
- **Google Chrome** (the real browser — not bundled Chromium)
- A Google account with access to Google Flow

## Install

### From npm (global)

```bash
npm install -g @swissmarley/gflow-cli
```

This puts a `gflow` command on your `PATH`.

### From source

```bash
git clone https://github.com/swissmarley/gflow-cli.git
cd gflow-cli
npm install
npm install -g .      # exposes `gflow` globally
```

If Chrome is installed in a non-standard location, point `gflow` at it:

```bash
export GFLOW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Quickstart

```bash
# 1. Sign in (opens Chrome — complete login and leave the window open)
gflow auth login

# 2. Verify the session
gflow doctor

# 3. Generate
gflow image --id hero --prompt "minimal editorial product still" --out ./out
gflow video --id reveal --prompt "slow dolly over a misty lake" --duration 8 --out ./out
```

> Keep the Chrome window open between commands — it's your live session. If you close it, just
> run `gflow auth login` again.

## Commands

### `gflow auth login`

Opens Chrome on the Flow page with an isolated profile (`.gflow/profiles/<name>`). Complete
login and **leave the window open**.

| Option | Default | Description |
| --- | --- | --- |
| `--profile <name>` | `default` | Named browser profile |

### `gflow doctor`

Attaches to your Flow window (or launches one) and confirms you're signed in and ready.

### `gflow image`

| Option | Default | Description |
| --- | --- | --- |
| `--id <id>` | _required_ | Job id (used in output filenames) |
| `--prompt <text>` | _required_ | Generation prompt |
| `--model <name>` | Flow default | `Nano Banana 2`, `Nano Banana Pro`, `Imagen 4` |
| `--ratio <ratio>` | Flow default | `16:9`, `4:3`, `1:1`, `3:4`, `9:16` |
| `--outputs <n>` | `1` | Number of images (1–4) |
| `--out <path>` | `./gflow-output` | Output directory |
| `--timeout <seconds>` | `900` | Generation timeout |
| `--profile <name>` | `default` | Browser profile |

### `gflow video`

Everything in `image`, plus:

| Option | Default | Description |
| --- | --- | --- |
| `--model <name>` | `Omni Flash` | `Omni Flash`, `Veo 3.1 - Lite/Fast/Quality` |
| `--ratio <ratio>` | Flow default | `16:9`, `9:16` |
| `--duration <seconds>` | Flow default | `4`, `6`, `8`, `10` |
| `--start-frame <path>` | — | First-frame image (enables **Frames** mode) |
| `--end-frame <path>` | — | Last-frame image (Frames mode) |
| `--timeout <seconds>` | `1800` | Generation timeout |

Model names are matched loosely, so `--model veo-3.1-fast` and `--model "Veo 3.1 - Fast"` are
equivalent.

#### Frames (first/last frame → video)

By default video is text-to-video. Pass frame images to animate between them instead:

```bash
gflow video --id morph --prompt "smooth cinematic transition" \
  --start-frame ./first.png --end-frame ./last.png --duration 4 --out ./out
```

`--end-frame` is optional (provide only `--start-frame` to animate from a single first frame).

### `gflow batch`

Run multiple jobs from a YAML pipeline:

```bash
gflow batch pipeline.yaml --out ./out
```

```yaml
# pipeline.yaml
jobs:
  - id: shot-1
    type: image
    prompt: "a neon-lit alley at night"
    ratio: "16:9"
  - id: clip-1
    type: video
    prompt: "rain falling on the alley"
    duration: 8
```

Jobs run serially. Use `--continue-on-failure` to keep going after ordinary generation errors.

## Output

Files are written directly into `--out` (the job id keeps them unique):

```text
out/
  gflow-run.json          # batch run summary
  <job-id>-001.png        # or .mp4 for video
  <job-id>-001.json       # per-result metadata
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `GFLOW_CHROME_PATH` | Path to the Google Chrome executable |

Use `--profile <name>` across commands to keep separate logged-in sessions.

## Troubleshooting

- **"Google Flow login is required"** — run `gflow auth login`, finish signing in, and leave the
  window open before re-running.
- **Chrome won't start / wrong path** — set `GFLOW_CHROME_PATH`.
- **A generation step can't find a control** — Flow's UI changes over time; open an issue with the
  command you ran.

## Development

```bash
npm install
npm run dev -- doctor   # run from source without a global install
npm run build
npm run lint
npm test
```

CI (lint + build + test on Node 20 & 22) runs on every push and pull request.

## Disclaimer

`gflow` is an **unofficial** tool and is not affiliated with, endorsed by, or sponsored by Google.
It automates *your own* Google Flow session through a real browser; you are responsible for
complying with Google's Terms of Service and any usage limits. It does not bypass login, solve
CAPTCHAs, rotate accounts, strip watermarks, or evade rate limits.

## License

[MIT](LICENSE) © swissmarley
