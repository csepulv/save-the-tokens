# sekko

Capture browser and terminal sessions, then extract structured artifacts an AI agent can read to understand how an app or CLI tool works. Record what a user does — clicks, commands, API calls — with optional voice-over narration explaining *why*.

> **DISCLAIMER / PSA:** Shared as-is, I hope it helps. This space is
> evolving quickly. I am sharing to help others wade through the fog and
> swamp, as I have been doing. Look around; there are probably better
> tools than this one. 😉

## Why

Working with Claude Code on existing projects, I wanted a quick way to
*teach* Claude the app — how to use it, the user flow, the important
screens. So Claude Code and I did a sidebar on the project we were
working on, built `sekko`, then used it. It lowered a lot of the friction
of working on brownfield code. One concrete win: sekko made it much
easier to add or patch acceptance-test suites, which are vital when
working in existing codebases.

Your mileage may vary — I share it in case it helps. There are other
tools in this space; look around before settling.

## How it works

Two steps: **record** a session, then **extract** structured artifacts
from the recording. Narration is optional.

- `sekko record-web <url>` — open a Chromium browser, capture clicks,
  navigation, network requests, DOM snapshots, screenshots. Save as a
  Playwright trace (`.zip`) + HAR + user-events JSON.
- `sekko record-terminal` — open an interactive shell, capture every
  command + output + exit code. Save as asciicast (`.cast`) with
  command-boundary markers.
- `sekko extract <input>` — turn a trace or terminal recording into
  agent-consumable markdown (actions, selectors, network, screenshots,
  terminal session, summary). Auto-detects format by extension.
- `--narrate` on either recording command — capture voice-over audio
  alongside the session. Transcribe inline (or later via
  `sekko transcribe`); extract merges the transcript into the output.

## Install

> **Platform:** macOS Apple Silicon (`darwin-arm64`) only. The
> terminal-recording path uses `node-pty` with a vendored arm64
> prebuild; on other platforms `npm install` will refuse with
> `EBADPLATFORM`. Cross-platform support hasn't been validated; if
> you'd find it useful, open an issue.

```bash
npm install -g sekko
npx playwright install chromium
```

Or from source:

```bash
git clone https://github.com/csepulv/save-the-tokens
cd save-the-tokens/tools/sekko
npm install
npm link
npx playwright install chromium
```

For voice-over narration, see [Narration](#narration) below — needs
SoX and either whisper-cpp (local) or Deepgram (cloud).

## Quick Start

### 1. Record a browser trace

```bash
sekko record-web https://your-app.com --output ./my-trace
```

A Chromium browser opens. Use the app — navigate, click, fill forms.
When you're done, close the browser window. sekko saves:

- `trace.zip` — full Playwright trace (actions, DOM snapshots, screenshots, network)
- `recording.har` — HAR file (all HTTP requests/responses), sanitized by default — see [HAR sanitization](#har-sanitization)
- `user-events.json` — captured user interactions (clicks, form fills, navigation)

### 2. Record a terminal session

```bash
sekko record-terminal --output ./my-session
```

An interactive shell opens (zsh preferred, bash fallback). Use it
normally — run commands, install packages, configure tools. Type
`exit` or Ctrl-D to stop. sekko saves:

- `recording.cast` — asciicast v2 recording with command-boundary markers

### 3. Extract artifacts

```bash
# From a browser trace
sekko extract ./my-trace/trace.zip --output ./context

# From a terminal recording
sekko extract ./my-session/recording.cast --output ./context
```

**Browser trace** produces:

- `summary.md` — start here. Lists all artifacts and how to use them.
- `actions.md` — what the user did, in order (clicks, navigation, form fills with selectors). Correlated with network request IDs.
- `network.md` — HTTP request summary table with IDs, correlated to triggering actions.
- `network-detail.json` — full request/response bodies, referenced by ID.
- `selectors.md` — unique selectors for interactive elements.
- `screenshots/` — visual state at key moments.
- `narration.md` — timestamped voice-over transcript (when narration.json is present).

**Terminal recording** produces:

- `summary.md` — artifact manifest.
- `terminal-session.md` — every command, its output, exit code, and duration.
- `terminal-session.json` — same data in structured JSON.
- `narration.md` — voice-over transcript (when narration.json is present).

Terminal extraction includes credential redaction (GitHub tokens, AWS
keys, bearer tokens, database passwords), interactive-program detection
(vim, less), and long-output truncation.

### 4. Filter to your app's API (browser traces)

Most traces include noise — CDN requests, auth providers, dev-server
assets. Filter to just your app's API:

```bash
sekko extract ./my-trace/trace.zip --include-hosts localhost:3456 --output ./context
```

Or exclude specific hosts:

```bash
sekko extract ./my-trace/trace.zip --exclude-hosts fonts.googleapis.com,clerk.accounts.dev --output ./context
```

## Commands

| Command | Purpose |
|---|---|
| `sekko record-web <url>` | Record a browser session as a Playwright trace |
| `sekko record-terminal` | Record a terminal session as asciicast |
| `sekko extract <input>` | Extract agent-consumable artifacts (auto-detects `.zip` vs `.cast`) |
| `sekko transcribe <audio>` | Transcribe voice-over WAV to `narration.json` |
| `sekko setup` | Check and install narration dependencies (SoX, whisper-cpp, model) |
| `sekko profile list` | List persistent profiles in `~/.sekko/profiles/` |
| `sekko profile rm <name>` | Remove a persistent profile |

### `sekko record-web <url>`

Record a browser session.

```bash
sekko record-web https://your-app.com
sekko record-web https://your-app.com --narrate
sekko record-web https://your-app.com --output ./traces/session-1
sekko record-web https://your-app.com --auth auth-state.json          # reuse saved login
sekko record-web https://your-app.com --save-auth auth-state.json     # save login for later
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./sekko-output` |
| `--auth <path>` | Load browser storage state from JSON (ignored when a profile is set or `--connect`) | — |
| `--save-auth <path>` | Save browser storage state to JSON on close (ignored when a profile is set or `--connect`) | — |
| `--profile <name>` | Use a persistent profile at `~/.sekko/profiles/<name>` | — |
| `--user-data-dir <path>` | Use a persistent profile at an arbitrary path | — |
| `--load-extension <paths>` | Load unpacked Chromium extensions (comma-separated dirs); requires a profile | — |
| `--connect [url]` | Attach to a running Chrome via CDP instead of launching one | `http://127.0.0.1:9222` when passed (IPv4; Chrome's debug port doesn't listen on IPv6 by default) |
| `--viewport <wxh>` | Fixed viewport size (e.g., `1920x1080`) | track window |
| `--system-screenshots` | Use full-window system screencaptures (1Hz) instead of Playwright page-area screenshots — needed to capture extension popups | off |
| `--no-sanitize` | Skip HAR sanitization. Default redacts cookies, auth headers, query/body tokens, and known credential patterns (Bearer/JWT, AWS keys, GitHub tokens, basic-auth in URLs, DB connection strings, private-key blocks) | sanitize on |
| `--narrate` | Record voice-over audio (requires SoX) | off |
| `--keyterm <terms>` | Domain-specific terms for transcription accuracy (comma-separated) | — |

By default the page area tracks the OS window — resize the window during
recording and the page grows with it. Pass `--viewport 1920x1080` (or any
`<width>x<height>`) for a fixed viewport instead.

#### Persistent profiles and extensions

Without `--profile` or `--user-data-dir`, sekko opens a fresh Chromium
profile per run and discards it on close (today's behavior). Pass
`--profile <name>` to keep state — cookies, localStorage, installed
extensions, settings — across runs in `~/.sekko/profiles/<name>/`.

```bash
# Profile under ~/.sekko/profiles/ext-dev
sekko record-web https://your-app.com --profile ext-dev

# Profile at an arbitrary path
sekko record-web https://your-app.com --user-data-dir /tmp/sekko-test
```

When a profile is in use, `--auth` and `--save-auth` are ignored — the
profile already owns auth state.

To trace a browser extension you're developing, point
`--load-extension` at the unpacked extension directory:

```bash
sekko record-web https://your-app.com \
  --profile ext-dev \
  --load-extension ~/code/my-extension/dist
```

Extensions require a persistent profile; sekko refuses
`--load-extension` without `--profile` or `--user-data-dir`. Multiple
extensions can be loaded with a comma-separated list:

```bash
sekko record-web https://your-app.com \
  --profile ext-dev \
  --load-extension ~/code/ext-a/dist,~/code/ext-b/dist
```

> **Heads up:** Don't point `--user-data-dir` at your real Chrome
> profile (`~/Library/Application Support/Google/Chrome/Default`).
> Chrome must be closed for it to work, sekko mutates the profile,
> and changes may sync to your Google account. Use a sekko-managed
> profile instead.

To inspect or remove profiles, see [Profile management](#profile-management).

#### Connecting to a running Chrome (Cloudflare-protected sites)

Some services (ChatGPT, Claude.com, anything behind Cloudflare's bot
challenge) detect Playwright-launched browsers and refuse to log in.
For these sites, sekko can attach to a Chrome instance you started
yourself with remote debugging enabled. The connected Chrome
already has your real cookies, your real fingerprint, and your
manually-completed login — so the bot challenge is already solved.

The recommended setup uses **Chrome Canary** as a dedicated
recording browser, leaving your everyday Chrome untouched:

1. Install Chrome Canary if not already (download from Google).
2. Start Canary with the debug port and a dedicated profile dir:

   ```bash
   "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/.canary-sekko"
   ```

   **Both flags are required.** Chrome refuses to expose remote
   debugging on the default profile (security policy — prevents
   anything on localhost from hijacking your real cookies/logins),
   so a separate `--user-data-dir` is mandatory. The path is
   stable, so the profile persists across runs — you only set it
   up once.

3. Verify the debug port is responding before continuing:

   ```bash
   curl http://127.0.0.1:9222/json/version
   ```

   Should print JSON with `Browser`, `webSocketDebuggerUrl`, etc.
   If it errors, check that the Canary launch above didn't fail
   (re-read the terminal output) and that no other Chrome instance
   is holding port 9222.

4. **First time only**, in this Canary instance:
   - Log into the protected service manually (chatgpt.com,
     claude.ai, etc.). Solve any Cloudflare challenges the same
     way a normal user would.
   - If you're recording an interaction with your own browser
     extension, install it via Canary's `chrome://extensions`
     (Developer mode → Load unpacked).

   Both logins and the unpacked extension persist in
   `~/.canary-sekko`, so subsequent runs skip this step.

5. From a separate terminal, run sekko in connect mode:

   ```bash
   sekko record-web https://chatgpt.com --connect
   ```

   sekko opens a fresh tab in Canary, navigates to the URL, and
   records what you do.
6. Close the new tab when you're done. sekko detaches; Canary
   stays running with all your other tabs intact.

> **IPv4 vs IPv6 note:** sekko's default connect URL is
> `http://127.0.0.1:9222` (not `localhost`). Node's DNS resolution
> on recent versions resolves `localhost` to `::1` (IPv6) first,
> but Chrome's `--remote-debugging-port` listens on IPv4 only by
> default, which causes `ECONNREFUSED ::1:9222`. If you pass an
> explicit `--connect <url>` and use `localhost`, sekko rewrites it
> to `127.0.0.1` for the same reason.

Notes on connect mode:

- **The recording is bounded by the tab sekko opens.** Activity in
  your other Canary tabs is not recorded.
- **Persistence and auth flags don't apply.** `--profile`,
  `--user-data-dir`, `--load-extension`, `--auth`, and `--save-auth`
  are mutually exclusive with `--connect` — the connected browser
  owns its own profile, extensions, and auth state.
- **No HAR file in connect mode.** HAR is set when the browser
  context is created; sekko attaches to a context it didn't start.
  Network data is still captured in `trace.zip` and surfaced via
  `network.md` / `network-detail.json` after extraction.

#### HAR sanitization

By default, `recording.har` is sanitized after the browser closes —
secret values are replaced (with `obfuscated` or `[REDACTED]`) but
header names, JSON keys, URL paths, query-param keys, and request/
response structure are preserved. The receiving agent can still
reason about the API shape; the secrets are gone.

What gets redacted:

- `Cookie` and `Set-Cookie` header values
- `Authorization` header value (the token after the scheme)
- `Referer` and `Location` header values (URL-walked for sensitive query params)
- Cookie arrays (`request.cookies`, `response.cookies`)
- URL query params named `access_token`, `id_token`, `code`,
  `refresh_token`, `token`, `password`, `email`, `secret`, etc.
- Same-named fields inside JSON request/response bodies
- Pattern-matched secrets anywhere in headers, URLs, or bodies:
  Bearer/JWT tokens (in non-`Authorization` headers too), AWS access
  keys (`AKIA…`), GitHub tokens (`ghp_…`, `gho_…`, `ghs_…`,
  `github_pat_…`), `TOKEN=`/`SECRET=`/`PASSWORD=` env-var
  assignments, basic auth in URLs (`https://user:pass@…`), DB
  connection strings (`postgres://`, `mysql://`, `mongodb://`,
  `redis://`), and PEM-formatted private key blocks

To opt out (the rare case where you genuinely need raw secrets in the
HAR — e.g. replaying against a sandbox API):

```bash
sekko record-web https://your-app.com --no-sanitize
```

> Sanitization runs on `recording.har` only. The same network data
> is also captured inside `trace.zip` (Playwright's internal
> network log) — `trace.zip` is **not** sanitized today. Treat it as
> sensitive when sharing.

#### Stopping a recording

Three signals end a recording cleanly — sekko saves trace.zip,
user-events.json, and recording.har (when applicable) for all
three:

| Signal | When |
|---|---|
| Page close | You close the tab sekko opened (and any popups it spawned). Default behavior. |
| Ctrl-C | You press Ctrl-C in the terminal that launched sekko. Useful when you want to keep the browser open after recording. |
| Browser quit | The browser sekko launched (or the connected Chrome) quits or crashes. sekko saves what's been recorded and exits non-zero. |

#### Capturing extension surfaces

When `--load-extension` is in use (or you've manually installed an
extension in your connected browser), sekko captures interactions
with the extension's popup, side panel, and options page —
anywhere a user might click or type. These show up in extracted
artifacts:

- `screenshots/action-NN-popup.jpeg` — popup state at the moment
  of the action (similarly `-sidepanel`, `-options`), **when the
  popup surfaces as a Playwright page**
- `actions.md` Page column — `popup` / `sidepanel` / `options`
  instead of a URL path
- `network-detail.json` — popup-driven fetches alongside page
  network calls (you can distinguish by URL or by timing relative
  to popup-labeled actions)

**By default**, sekko's screenshots come from Playwright's page-area
trace — clean shots of the page DOM, one per action. Manifest V3
extension popups don't surface as Playwright pages, so they aren't
captured this way (the popup-open event still appears in
`actions.md` via CDP target detection, just without a screenshot).

For extension testing, pass **`--system-screenshots`** to switch the
screenshot source from Playwright frames to system-level captures
of the browser window. The popup — attached to the toolbar by
Chromium — appears in those frames.

```bash
# Default flow — Playwright shots, no permission prompt, no extra disk
sekko record-web https://your-app.com

# Extension testing — system shots, captures popup state
sekko record-web https://your-app.com \
  --profile ext-dev \
  --load-extension ~/code/my-ext/dist \
  --system-screenshots
```

With `--system-screenshots`:

- Recording captures full-window JPEGs at 1Hz to
  `<output>/system-screenshots/screen-<epoch-ms>.jpg`. The window
  bounds are derived from `window.screenX/Y/outerWidth/outerHeight`
  and re-checked every 5 seconds, so resizing or moving the window
  is handled.
- `extract` picks the closest system frame to each action (preferring
  the frame just *after* the action so you see the result) and
  writes them to `<extract>/screenshots/action-NN.jpeg` — same
  filename pattern as the default Playwright path, just a different
  source. `summary.md` notes which source was used.
- macOS will prompt for Screen Recording permission on first use;
  grant it to the terminal running sekko (System Settings →
  Privacy & Security → Screen Recording).
- Disk cost: ~50 KB/frame × 60/min ≈ 3 MB/min during recording.

If sekko can't derive window bounds (rare; e.g., page evaluation
fails before bounds are computed), it falls back to capturing the
full display.

### `sekko record-terminal`

Record a terminal session. Shell hooks inject command-boundary markers
(preexec/precmd for zsh, `PROMPT_COMMAND` / `DEBUG` trap for bash) so
extraction can separate each command's output cleanly.

```bash
sekko record-terminal
sekko record-terminal --output ./sessions/session-1
sekko record-terminal --shell bash
sekko record-terminal --narrate --keyterm "kubectl,terraform"
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./sekko-output` |
| `--shell <shell>` | Shell to use (`zsh` or `bash`) | auto-detect (prefers zsh) |
| `--narrate` | Record voice-over audio (requires SoX) | off |
| `--keyterm <terms>` | Domain-specific terms for transcription accuracy (comma-separated) | — |

### `sekko extract <input>`

Extract artifacts from a browser trace (`.zip`) or terminal recording
(`.cast`). Auto-detects the format.

```bash
sekko extract ./my-trace/trace.zip --output ./context
sekko extract ./my-session/recording.cast --output ./context
sekko extract ./my-trace/trace.zip --include-hosts localhost:3456 --output ./context
```

If `narration.json` exists alongside the input, extraction includes
`narration.md` automatically. If `voice-over.wav` exists but
`narration.json` doesn't, extract reminds you to run `sekko transcribe`
first.

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./sekko-extract` |
| `--include-hosts <hosts>` | Only include requests to these hosts (comma-separated) | all hosts |
| `--exclude-hosts <hosts>` | Exclude requests to these hosts (comma-separated) | none |

### `sekko transcribe <audio-file>`

Transcribe a voice-over recording separately (if you skipped
transcription after recording, or want to re-transcribe with different
settings).

```bash
sekko transcribe ./my-trace/voice-over.wav
sekko transcribe ./my-trace/voice-over.wav --keyterm "JunkDrawer,foobar"
```

Reads `voice-over-meta.json` from the same directory for timestamp
correlation. Outputs `narration.json`. If a `.mp3` exists alongside the
`.wav`, uses that for Deepgram uploads.

### `sekko setup`

Check and install narration dependencies.

```bash
sekko setup
```

Walks through SoX, whisper-cpp, and the whisper model. Idempotent —
re-running skips already-installed items.

### Profile management

```bash
sekko profile list           # list profiles in ~/.sekko/profiles/
sekko profile rm <name>      # remove a profile
```

Profiles can grow as Chromium accumulates extension caches and
IndexedDB data over time. `sekko profile rm` removes a profile dir
in one shot; the next `record-web --profile <name>` recreates it
fresh. There is no automatic cleanup; nothing is removed without an
explicit command.

## Narration

Optional voice-over recording that adds *why* context to the *what* of
actions and commands. During recording, sekko captures your microphone;
after the recording, the audio is transcribed into `narration.json`.
When `sekko extract` runs and finds `narration.json` next to the
recording, the transcript merges into the output as `narration.md`.

### Install narration deps

```bash
sekko setup
```

Or manually:

```bash
brew install sox           # audio recording
brew install ffmpeg        # compresses WAV → MP3 for Deepgram uploads
brew install whisper-cpp   # local transcription (skip if using Deepgram)
mkdir -p ~/.sekko/models
curl -L -o ~/.sekko/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

`ffmpeg` is recommended — it compresses recordings from ~30 MB WAV to
~700 KB MP3, which is required for Deepgram cloud uploads and saves
disk space.

### Configure transcription backend

Copy `.env.sample` to `.env`:

```bash
cp .env.sample .env
```

Defaults to local whisper. For cloud transcription (Deepgram):

```bash
SEKKO_TRANSCRIPTION_MODE=deepgram
DEEPGRAM_API_KEY=your_api_key_here
```

See `.env.sample` for all options.

### Record with narration

```bash
sekko record-web https://your-app.com --narrate --output ./my-trace
sekko record-terminal --narrate --output ./my-session
```

Speak naturally while you use the app — explain what you're doing, why
you're clicking things, what the app is showing. When the session ends,
sekko prompts to transcribe immediately or defer.

Use `--keyterm` to improve transcription of domain-specific terms:

```bash
sekko record-web https://your-app.com --narrate --keyterm "JunkDrawer,foobar"
```

### Transcribe later

If you deferred during recording:

```bash
sekko transcribe ./my-trace/voice-over.wav --keyterm "JunkDrawer,foobar"
```

Then re-run `sekko extract` to pick up the new `narration.json`.

## Config file

For projects where you extract repeatedly with the same settings,
create `sekko.config.yaml` in your project root:

```yaml
includeHosts:
  - localhost:3456
```

CLI flags override config file values. See `sekko.config.yaml.example`
for all options.

## Auth state workflow

First session — log in once and save the cookies/local storage:

```bash
sekko record-web https://your-app.com --save-auth auth-state.json --output ./trace-1
```

Subsequent sessions — reuse the saved auth:

```bash
sekko record-web https://your-app.com --auth auth-state.json --output ./trace-2
```

Combine both on the first session to keep the auth file fresh:

```bash
sekko record-web https://your-app.com \
  --save-auth auth-state.json \
  --auth auth-state.json \
  --output ./trace-3
```

## Viewing traces

Open a trace in Playwright's trace viewer:

```bash
npx playwright show-trace ./my-trace/trace.zip
```

Or drag `trace.zip` onto [trace.playwright.dev](https://trace.playwright.dev).

## Troubleshooting

### `sekko record-* --narrate` fails with "SoX not found"

SoX isn't installed. Run `sekko setup` or `brew install sox`.

### Playwright can't find Chromium

Install browsers: `npx playwright install chromium`. This is a one-time
step; sekko doesn't run it for you on install.

### macOS microphone permission

First time you run `--narrate`, macOS asks your terminal (or IDE) for
microphone permission. If you denied it accidentally, grant it in
**System Settings → Privacy & Security → Microphone**.

### Deepgram returns 401 or 413

- **401**: `DEEPGRAM_API_KEY` missing or invalid in `.env`.
- **413**: WAV file over Deepgram's ~25 MB limit. sekko compresses
  WAV → MP3 via ffmpeg before upload — install ffmpeg
  (`brew install ffmpeg`) if missing. Without it, long recordings fail.

### Extract finds no actions

Playwright's `context.tracing` only records Playwright API calls.
sekko injects user-event listeners via `addInitScript` to capture
manual clicks, form fills, and navigation. If actions are missing,
the page probably closed before events flushed — the trace saves in
a `page.on('close')` handler, so close the **page** (not Ctrl-C the
process).

### Whisper transcription is slow or inaccurate

The default model is `ggml-small.en.bin` (small/fast/English). For
higher accuracy, swap to a larger model and point `SEKKO_WHISPER_MODEL`
at it. Or switch to Deepgram by setting `SEKKO_TRANSCRIPTION_MODE=deepgram`.

## Development

```bash
npm test            # vitest
npm run test:watch
```
