# gflow

`gflow` is a local CLI for driving Google Flow through your own logged-in Chrome. It opens a
real Google Chrome window, you sign in once, and `gflow` attaches to **that same window** over
the Chrome DevTools Protocol (CDP) to run Flow's normal UI. Because it drives a genuine,
human-signed-in browser, Google treats it as an ordinary session instead of automation.

## Boundaries

`gflow` does not replay private Google APIs, bypass login, solve CAPTCHA, rotate accounts,
strip watermarks, or evade Flow rate limits. If Flow asks for manual action, the CLI stops and
tells you what to do.

## Install

```bash
npm install
npm run build
npx playwright install chromium   # only needed for the offline fixture/test path
```

You also need **Google Chrome** installed (the real browser, not bundled Chromium):

```bash
brew install --cask google-chrome   # or download from https://www.google.com/chrome/
```

If Chrome is installed somewhere non-standard, point `gflow` at it:

```bash
export GFLOW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

If your global npm cache has permission issues, use a project-local cache:

```bash
npm install --cache ./.npm-cache
```

## Login

```bash
npm run dev -- auth login
```

This opens a real Google Chrome window (with an isolated `gflow` profile in
`.gflow/profiles/default`) on the Flow page, using a local debugging port. **Complete Google
login in that window — including any 2FA — and leave the window open.** Then run `doctor`.

`gflow` attaches to the window you logged into; it never spawns a separate automated browser,
which is what previously triggered repeated 2FA / "verify your identity" challenges.

## Doctor

```bash
npm run dev -- doctor
```

`doctor` attaches to your open Flow window (or launches one if none is running) and confirms
you are signed in and the Flow dashboard is reachable. Expect:

```text
gflow doctor: Flow browser session looks ready.
```

Keep that Chrome window open between commands — it is your live session. If you quit it, just
run `auth login` again.

## Image

```bash
npm run dev -- image \
  --id concept-image \
  --prompt "Minimal editorial product still on a warm studio background" \
  --ratio 1:1 \
  --outputs 1 \
  --out ./gflow-output
```

`gflow` opens (or creates) a project in your Flow window, sets the generation options in Flow's
in-editor settings popover, types the prompt, clicks **Create**, waits for the result(s), and
downloads each one into `--out`.

`--model`, `--ratio`, and `--outputs` are applied through the settings popover. Any option whose
value Flow doesn't currently offer is skipped (the current project setting is kept), so use values
Flow supports — e.g. image ratios `16:9 / 4:3 / 1:1 / 3:4 / 9:16`, outputs `1`–`4`. Image models:
`Nano Banana 2` (default), `Nano Banana Pro`, `Imagen 4`. Model name matching ignores spacing and
punctuation, so `--model imagen4` and `--model "Imagen 4"` are equivalent.

## Video

```bash
npm run dev -- video \
  --id hero-video \
  --prompt "A cinematic product reveal on a sunlit table, slow dolly in" \
  --ratio 16:9 \
  --outputs 1 \
  --out ./gflow-output
```

`gflow` switches Flow to **Video** mode automatically and applies `--ratio` (`16:9` / `9:16`),
`--duration` (`4` / `6` / `8` / `10` seconds), `--outputs`, and `--model`. Video models include
`Omni Flash` (default) and `Veo 3.1 - Lite / Fast / Quality`; `--model "Veo 3.1 - Fast"` (or
`veo-3.1-fast`) selects one. Video generations can take several minutes; the default timeout is
30 minutes (override with `--timeout <seconds>`).

### Frames (first/last frame to video)

By default video is **text-to-video** (Flow's "Ingredients" mode). To animate between a first
and last frame instead, pass image paths — `gflow` switches Flow to **Frames** mode and uploads
them into the Start/End slots:

```bash
npm run dev -- video \
  --id morph \
  --prompt "smooth transition, cinematic" \
  --start-frame ./frames/first.png \
  --end-frame ./frames/last.png \
  --out ~/Desktop/clips
```

`--end-frame` is optional (provide only `--start-frame` to animate from a single first frame).
Image paths are resolved relative to the current directory.

## Batch

```bash
npm run dev -- batch examples/pipeline.yaml --out ./gflow-output
```

Outputs are written as:

```text
gflow-output/
  gflow-run.json
  <job-id>-001.png
  <job-id>-001.json
```

Files are written directly into `--out` (the job-id prefix keeps them unique).

Batch jobs run serially on the same Flow window. Login prompts, manual verification, rate
limits, credit issues, and policy blocks stop the run.

## How it works

- **Login** launches the real Chrome binary with `--remote-debugging-port` and leaves it
  running.
- **doctor / image / video / batch** find that window via its `DevToolsActivePort` and attach
  with Playwright's `connectOverCDP`. They reuse your open tab and disconnect (without closing
  Chrome) when done.
- **Downloads** fetch Flow's authenticated `media.getMediaUrlRedirect` URLs through the
  logged-in context, so results are saved without any browser download dialog.

`--browser chromium` switches to a bundled-Chromium persistent context, used only for the
offline fixture tests; Google sign-in rejects it.
