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
- `recording.har` — HAR file (all HTTP requests/responses)
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
| `--auth <path>` | Load browser storage state from JSON | — |
| `--save-auth <path>` | Save browser storage state to JSON on close | — |
| `--narrate` | Record voice-over audio (requires SoX) | off |
| `--keyterm <terms>` | Domain-specific terms for transcription accuracy (comma-separated) | — |

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
