# Setting up sekko

This reference covers first-time install and the optional narration
dependency chain. The user usually runs through this once per machine.

## Install sekko itself

**Platform:** macOS Apple Silicon (`darwin-arm64`) only. The
terminal-recording path uses a vendored arm64 `node-pty` prebuild; on
other platforms `npm install` errors with `EBADPLATFORM`.

```bash
# Global install (most common)
npm install -g sekko

# Then install the Chromium browser Playwright drives
npx playwright install chromium
```

Or from source (this repo):

```bash
cd tools/sekko
npm install
npm link
npx playwright install chromium
```

`npx playwright install chromium` is a one-time step. Sekko doesn't run
it for you on install — if `record-web` fails with a Playwright
"browser not found" error, that's the missing step.

## Verify install

```bash
sekko --version            # prints the version
sekko --help               # lists available commands
```

The user should see:

```
record-web      Record a Playwright trace of a browser session
record-terminal Record a terminal session
extract         Extract agent-consumable artifacts from a Playwright trace
transcribe      Transcribe a voice-over recording to narration.json
setup           Check and install dependencies for narration ...
profile         Manage persistent browser profiles for record-web
```

`trace` is also accepted as a hidden alias for `record-web`.

## Optional: narration dependencies

Only needed if the user wants `--narrate`. Two backends, choose one (or
install both):

### Auto-install via `sekko setup`

```bash
sekko setup
```

Walks through SoX, whisper-cpp, and the whisper model. Idempotent —
re-running skips already-installed items. This is the recommended
path; manual install below is the explicit equivalent.

### Manual install

```bash
brew install sox           # required — audio recording
brew install ffmpeg        # recommended — compresses WAV → MP3 for Deepgram

# For local transcription (whisper.cpp backend):
brew install whisper-cpp
mkdir -p ~/.sekko/models
curl -L -o ~/.sekko/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

Why each:

- **sox** — `rec` command records mic audio. Required for `--narrate`.
- **ffmpeg** — compresses WAV (~30 MB for a few minutes) to MP3
  (~700 KB) before Deepgram upload. Deepgram rejects WAVs over ~25 MB.
  Without ffmpeg, long Deepgram uploads fail with 413.
- **whisper-cpp** — local transcription engine. Skip if using
  Deepgram exclusively.
- **whisper model** — `ggml-small.en.bin` is the default
  English-only small/fast model. For higher accuracy, swap to a larger
  model (e.g., `ggml-medium.en.bin` or `ggml-large-v3.bin`) and point
  `SEKKO_WHISPER_MODEL` at it in `.env`.

### Configure transcription backend

Copy `.env.sample` to `.env` in the sekko install directory (for `-g`
installs, this is wherever npm dropped the package; for source installs,
it's `tools/sekko/.env`):

```bash
cp .env.sample .env
```

Defaults to local whisper. For Deepgram:

```
SEKKO_TRANSCRIPTION_MODE=deepgram
DEEPGRAM_API_KEY=your_api_key_here
```

See `.env.sample` for all variables.

### macOS permissions the user will hit

Two permission prompts appear the first time relevant features are used.
Grant them to the **terminal app running sekko** (Terminal.app, iTerm,
Warp, etc.) — not to sekko itself:

| First time using… | Prompt | Where to grant |
|---|---|---|
| `--narrate` | Microphone access | System Settings → Privacy & Security → Microphone |
| `--system-screenshots` or `--trace-extensions` | Screen Recording access | System Settings → Privacy & Security → Screen Recording |

If the user denies accidentally, re-grant in the panel above and
re-run.

## When the user is using sekko from this repo (not global install)

If the user has the source clone of `save-the-tokens` and wants to
invoke sekko from there without `npm link`:

```bash
node /path/to/save-the-tokens/tools/sekko/bin/sekko.js record-web https://...
```

Useful for testing changes to sekko itself, or when a globally-installed
version exists at an older revision than the repo.
