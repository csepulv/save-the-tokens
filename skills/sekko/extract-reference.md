# Extracting and Transcribing

After recording (`record-web` or `record-terminal`), the recording
directory contains raw artifacts. Two commands turn them into
agent-consumable bundles:

- `sekko transcribe` — voice-over WAV → `narration.json` (if narration
  was recorded and not transcribed inline)
- `sekko extract` — trace.zip or recording.cast → markdown bundle

Order matters when narration is involved: **transcribe first, then
extract.** If `narration.json` doesn't exist alongside the recording
when `extract` runs, the narration won't be in the output.

## `sekko extract <input>`

Auto-detects the format by extension:

- `.zip` → browser extract path
- `.cast` → terminal extract path

```bash
# Browser extract — minimum form
sekko extract ./my-trace/trace.zip --output ./context

# Terminal extract — minimum form
sekko extract ./my-session/recording.cast --output ./context

# Filter to your app's API only
sekko extract ./my-trace/trace.zip \
  --include-hosts localhost:3456,api.my-app.com \
  --output ./context

# Exclude noise (analytics, fonts, auth providers)
sekko extract ./my-trace/trace.zip \
  --exclude-hosts fonts.googleapis.com,clerk.accounts.dev,segment.io \
  --output ./context
```

CLI flags override anything set in a project-level
`sekko.config.yaml`.

### What it produces

See `consume-reference.md` for the full file inventory and how to read
the output. Highlights:

- **Browser:** `summary.md`, `actions.md`, `network.md`,
  `network-detail.json`, `selectors.md`, `screenshots/`,
  optional `narration.md`
- **Terminal:** `summary.md`, `terminal-session.md`,
  `terminal-session.json`, optional `narration.md`

### When extract surprises you

- **"No actions found" / "no user events"** — Playwright's
  `context.tracing` only records Playwright API calls (`page.goto`,
  `page.click` from code). Manual clicks/fills come from `user-events.json`
  which is written by an injected init script. If `user-events.json` is
  empty or missing, the recording probably ended before page-close
  fired (e.g., the user killed the process instead of closing the
  page).
- **Narration missing from output** — extract looks for
  `narration.json` *next to the input file*. If you have
  `voice-over.wav` but no `narration.json`, run `sekko transcribe`
  first, then re-run `sekko extract`.
- **`network.md` is huge with mostly noise** — use `--include-hosts`
  or `--exclude-hosts` to filter. The flags accept comma-separated
  host names (with or without port). For a project the user extracts
  repeatedly, suggest creating `sekko.config.yaml` in the project
  root with persistent `includeHosts` / `excludeHosts` arrays.
- **`network-detail.json` is megabytes** — that's expected. Don't read
  it linearly; index by ID from `network.md` and read only the entries
  the relevant actions reference.

### When to filter, and how

The default extract includes every host. For real apps, that's:

- The app itself (`localhost:3456`, `my-app.com`, …)
- Auth providers (`clerk.accounts.dev`, `auth0.com`, …)
- CDN/asset hosts (`fonts.googleapis.com`, `cdn.…`, …)
- Analytics/telemetry (`segment.io`, `posthog.com`, `google-analytics.com`)
- Development tooling (HMR pings on Vite/webpack dev servers)

Default heuristic: if the user only cares about their app's API,
`--include-hosts` is sharper. If they want most of the picture minus
known noise, `--exclude-hosts` is gentler.

## `sekko transcribe <audio>`

Standalone transcription — use when the user deferred transcription
during recording, or wants to re-transcribe with different settings
(e.g., add `--keyterm` values).

```bash
sekko transcribe ./my-trace/voice-over.wav
sekko transcribe ./my-trace/voice-over.wav --keyterm "JunkDrawer,foobar"
```

Outputs `narration.json` in the same directory as the audio.

### Backend selection

Configured in `tools/sekko/.env` (copied from `.env.sample` during
setup):

```
SEKKO_TRANSCRIPTION_MODE=whisper      # local; default
# or
SEKKO_TRANSCRIPTION_MODE=deepgram
DEEPGRAM_API_KEY=...
```

| Backend | Pros | Cons |
|---|---|---|
| whisper.cpp (local) | No API key, no network, handles any file size | Slower; quality varies by model; default model is `ggml-small.en.bin` (English-only, small/fast) |
| Deepgram (cloud) | Fast, accurate, good with `--keyterm` | API key required; WAV files over ~25 MB need ffmpeg-based MP3 compression (sekko handles automatically if ffmpeg is installed) |

### Keyterms

`--keyterm "term1,term2"` improves transcription of domain-specific
vocabulary — product names, internal jargon, library/framework names
that the model wouldn't otherwise recognize. Especially valuable for
Deepgram. Use it when:

- Internal product names are mentioned in narration
- The narration uses specific library or tool names that get mangled
  (e.g., "kubectl", "terraform", "helmfile")
- Trade or domain terms that aren't general English

### Re-transcribing

If a transcript came out poorly:

1. Run `sekko transcribe` again with adjusted keyterms or after
   switching the backend in `.env`.
2. Then re-run `sekko extract` — it will pick up the fresh
   `narration.json`.

## Quick Sanity Checklist Before Extract

If you're about to extract someone else's recording, do this once
upfront to avoid surprises:

- [ ] Recording directory contains `trace.zip` *or* `recording.cast`
      (not both — they're different recording types)
- [ ] If `voice-over.wav` is present, also `narration.json` is — if
      not, run `sekko transcribe` first
- [ ] If sensitive site: confirm `recording.har` is sanitized (default)
      or that the user passed `--no-sanitize` deliberately
- [ ] If extension recording: confirm `system-screenshots/` exists
      (proves `--system-screenshots` or `--trace-extensions` was on);
      otherwise popup state isn't in screenshots
