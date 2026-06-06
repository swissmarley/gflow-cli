<div align="center">

<img src="https://raw.githubusercontent.com/swissmarley/gflow-cli/main/assets/logo.svg" alt="gflow" width="460">

# gflow-cli

**Generate images and videos with [Google Flow](https://labs.google/fx/tools/flow) from your terminal.**

`gflow` drives Flow inside your own logged-in Google Chrome, so it works as a normal, human
browser session — no private APIs, no login bypass.

[![CI](https://github.com/swissmarley/gflow-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/swissmarley/gflow-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@swissmarley/gflow-cli)](https://www.npmjs.com/package/@swissmarley/gflow-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

<br>

<img src="https://raw.githubusercontent.com/swissmarley/gflow-cli/main/assets/demo.gif" alt="gflow demo: auth login, doctor, image and video generation" width="760">

</div>

---

## Features

- 🖼️ **Image generation** — Nano Banana 2 / Pro, Imagen 4
- 🎬 **Video generation** — Omni Flash, Veo 3.1 (Lite / Fast / Quality)
- 🎞️ **Frames mode** — animate between a first and last frame image
- 🎛️ **Full control** — model, aspect ratio, duration, output count
- 📦 **Batch pipelines** — run many jobs from a YAML file
- ⬆️ **Full-quality downloads** — pulls Flow's native asset via the in-app Download menu; add `--upscale 2k` or `--upscale 4k` for upscaled tiers
- 🧑‍🎨 **Characters** — create and reuse saved character references across generations
- 🛠️ **Tools** — build and open custom Flow tools (image-filter, style-morph, etc.)
- 🤖 **Agent** — drive the Flow Agent with a prompt, configure its defaults, and manage persistent instructions
- 🔒 **Your session** — attaches to the Chrome you log into; nothing is stored beyond the
  browser profile on your disk

## How it works

`gflow` never spawns a hidden automation browser (Google challenges those with repeated 2FA).
Instead:

1. `gflow auth login` opens a **plain Google Chrome** (no remote-debugging flags) so you can
   sign in normally — Google blocks sign-in in browsers with remote debugging enabled
   ("this browser or app may not be secure").
2. You sign in once (including any 2FA) in that window.
3. The first automation command (`doctor`, `image`, …) hands that window over to an
   **automation session**: it reopens the same, now signed-in, profile with a debugging port
   and attaches over the Chrome DevTools Protocol (`connectOverCDP`). It only ever loads Flow
   with valid cookies — never the accounts sign-in page — so the block never applies.
4. From then on, commands reuse that window, drive Flow's normal UI, and download results
   through Flow's own authenticated media URLs.

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
# 1. Sign in (opens a plain Chrome — just complete the Google login)
gflow auth login

# 2. Verify the session (reopens Chrome as an automation session)
gflow doctor

# 3. Generate
gflow image --id hero --prompt "minimal editorial product still" --out ./out
gflow video --id reveal --prompt "slow dolly over a misty lake" --duration 8 --out ./out
```

> After `doctor`, keep the automation Chrome window open between commands — it's your live
> session. If you close it, the next command reopens it from your saved login. If you ever get
> signed out, run `gflow auth login` again.

## Commands

### `gflow auth login`

Opens a **plain** Chrome (no remote-debugging flags) on the Flow page with an isolated profile
(`.gflow/profiles/<name>`). Complete the Google login here — signing in must happen in an
ordinary window, or Google rejects it as "not secure". The next command takes the session over
for automation.

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
| `--character <name...>` | — | Reference one or more saved characters |
| `--upscale <tier>` | — | Download upscaled output: `2k` or `4k` (4K requires a Flow plan that allows it) |
| `--out <path>` | `./gflow-output` | Output directory |
| `--timeout <seconds>` | `900` | Generation timeout |
| `--project <name>` | — | Flow project |
| `--profile <name>` | `default` | Browser profile |
| `--browser <name>` | `chrome` | Browser channel: `chrome` or `chromium` |
| `--headed` / `--no-headed` | headed | Show or hide the browser |

### `gflow video`

All `image` options apply, plus:

| Option | Default | Description |
| --- | --- | --- |
| `--model <name>` | `Omni Flash` | `Omni Flash`, `Veo 3.1 - Lite/Fast/Quality` |
| `--ratio <ratio>` | Flow default | `16:9`, `9:16` |
| `--duration <seconds>` | Flow default | `4`, `6`, `8`, `10` |
| `--start-frame <path>` | — | First-frame image (enables **Frames** mode) |
| `--end-frame <path>` | — | Last-frame image (Frames mode) |
| `--character <name...>` | — | Reference one or more saved characters |
| `--upscale <tier>` | — | Download upscaled output: `2k` or `4k` |
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

### `gflow character`

Create and manage saved character references that can be reused in `image` and `video` generations via `--character <name>`.

#### `gflow character create`

| Option | Default | Description |
| --- | --- | --- |
| `--prompt <text>` | _required_ | Character description |
| `--name <name>` | — | Label for the character |
| `--model <model>` | Flow default | `nano-banana-2` or `nano-banana-pro` |
| `--preset <preset>` | — | `familiar`, `eccentric`, `wicked`, or `fantastical` |
| `--image <path...>` | — | One or more reference images to upload |
| `--from-project <name...>` | — | Reference asset name(s) from the current project |
| `--out <path>` | `./gflow-output` | Output directory (thumbnail saved here) |

Also accepts the shared session options: `--project`, `--profile`, `--browser`, `--headed`/`--no-headed`.

```bash
gflow character create --prompt "a cheerful red-haired wizard" --name Merlin --preset fantastical

# Reference an existing image as a starting point
gflow character create --prompt "heroic knight" --name Arthur --image ./knight-ref.png
```

#### `gflow character list`

Print the names of all saved characters (scoped to `--project` if provided).

```bash
gflow character list
gflow character list --project my-film
```

### `gflow tool`

Build and open custom Flow tools.

#### `gflow tool create`

| Option | Default | Description |
| --- | --- | --- |
| `--prompt <text>` | _required_ | Describe the tool to build |
| `--name <name>` | — | Label for the created tool |
| `--preset <preset>` | — | `image-filter`, `style-morph`, `time-stretcher`, or `voice-over` |

Also accepts the shared session options: `--project`, `--profile`, `--browser`, `--headed`/`--no-headed`.

```bash
gflow tool create --prompt "turn any photo into a watercolour painting" --name Watercolour --preset image-filter
```

#### `gflow tool list`

Print the names of all saved tools.

```bash
gflow tool list
```

#### `gflow tool open`

| Option | Default | Description |
| --- | --- | --- |
| `--name <name>` | _required_ | Name of the tool to open |

```bash
gflow tool open --name Watercolour
```

### `gflow agent`

Drive the Flow Agent from the command line. Results are downloaded at full quality.

#### `gflow agent --prompt "<text>"`

| Option | Default | Description |
| --- | --- | --- |
| `--prompt <text>` | _required_ | Prompt to send to the agent |
| `--id <id>` | `agent` | Job id used in output filenames |
| `--out <path>` | `./gflow-output` | Output directory |

Also accepts: `--project`, `--profile`, `--browser`, `--headed`/`--no-headed`.

```bash
gflow agent --prompt "create a moody noir poster for a jazz club"
gflow agent --prompt "animate the poster as a short looping video" --id jazz-loop --out ./out
```

#### `gflow agent settings`

Configure the agent's default generation behaviour.

| Option | Default | Description |
| --- | --- | --- |
| `--confirm <mode>` | — | Auto-confirm agent actions: `always` or `never` |
| `--image-model <m>` | — | Default image model |
| `--image-ratio <r>` | — | Default image aspect ratio |
| `--image-quantity <n>` | — | Default number of images (1–4) |
| `--video-model <m>` | — | Default video model |
| `--video-ratio <r>` | — | Default video aspect ratio |
| `--video-quantity <n>` | — | Default number of videos (1–4) |

```bash
gflow agent settings --confirm always --image-quantity 2 --video-model "Veo 3.1 - Fast"
```

#### `gflow agent instruction add`

Add a persistent guideline the agent follows in every run.

| Option | Default | Description |
| --- | --- | --- |
| `--text <guideline>` | _required_ | Instruction text |
| `--ref <name>` | — | Project image to attach as a visual reference |

```bash
gflow agent instruction add --text "always use a dark, cinematic colour palette"
gflow agent instruction add --text "match the brand colours" --ref brand-swatch.png
```

#### `gflow agent instruction list`

Print all active agent instructions.

```bash
gflow agent instruction list
```

#### `gflow agent instruction clear`

Remove all agent instructions.

```bash
gflow agent instruction clear
```

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

- **"Couldn't sign you in — this browser or app may not be secure"** — make sure you sign in via
  `gflow auth login` (a plain window), not by reopening the automation window. Sign-in must
  happen in a browser without remote debugging. Update to the latest version if you still hit it.
- **"Google Flow login is required"** — run `gflow auth login`, finish signing in, then re-run.
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
