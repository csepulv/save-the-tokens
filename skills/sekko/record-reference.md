# Recording Sessions with sekko

Sekko records two kinds of sessions: **browser** (`record-web`) and
**terminal** (`record-terminal`). Both produce a directory the
`extract` command later reads.

For exhaustive flag tables, point the user at `tools/sekko/README.md`
(or `sekko record-web --help` / `sekko record-terminal --help`). This
reference covers *which mode + which flags fit which job*, and the
pitfalls that aren't obvious.

## Which Mode Fits the Job

| The user wants to… | Use |
|---|---|
| Show you how they use a web app | `sekko record-web <url>` |
| Capture a Cloudflare/bot-protected site (ChatGPT, Claude.com) | `sekko record-web <url> --connect` (see "Connect mode" below) |
| Demo a browser extension they're building or using | `sekko record-web <url> --load-extension <path> --profile <name> --trace-extensions` |
| Show you a CLI workflow | `sekko record-terminal` |
| Demo an install procedure / setup walkthrough | `sekko record-terminal` |
| Explain *why* alongside the *what* | Either, with `--narrate` (needs SoX installed) |

## Browser: `sekko record-web <url>`

### The shape

```bash
sekko record-web <url> --output <dir> [flags]
```

A Chromium window opens at `<url>`. The user uses the app. The
recording ends when:

- The user closes the page sekko opened (clean save)
- The user presses Ctrl-C in the terminal that launched sekko (clean save)
- The browser quits or crashes (sekko saves what it has, exits non-zero)

Pre-flight check sekko already does:

- `--load-extension` requires `--profile` or `--user-data-dir`
- `--trace-extensions` requires `--load-extension` or `--connect`
- `--connect` is mutually exclusive with `--profile`, `--user-data-dir`,
  `--load-extension`, `--auth`, `--save-auth` (the connected browser
  owns its own profile and extensions)

### Output directory layout

```
<output>/
├── trace.zip              # full Playwright trace (always)
├── recording.har          # HAR file (sanitized by default; NOT created in --connect mode)
├── user-events.json       # manual user interactions (always)
├── system-screenshots/    # only with --system-screenshots or --trace-extensions
└── voice-over.wav         # only with --narrate (+ voice-over-meta.json)
```

`narration.json` shows up later — either inline at the post-recording
prompt or via `sekko transcribe` (see `extract-reference.md`).

### Common flag recipes

```bash
# Plain web app, no extension, no narration
sekko record-web https://my-app.local:3000

# Web app, with reusable auth across runs
sekko record-web https://my-app.com --save-auth ./auth.json    # first time
sekko record-web https://my-app.com --auth ./auth.json         # subsequent

# CF-protected site (user has Chrome Canary on :9222 already)
sekko record-web https://chatgpt.com --connect

# Extension end-to-end (the common case for extension work)
sekko record-web https://target-site.com \
  --profile ext-dev \
  --load-extension ~/code/my-ext/dist \
  --trace-extensions

# Add narration to any of the above
... --narrate --keyterm "JunkDrawer,foobar"
```

### Sanitization — what the agent should remember

- HAR (`recording.har`) is sanitized by default. Cookies, auth headers,
  bearer/JWT/AWS/GitHub-token shapes, basic-auth URLs, DB connection
  strings, and PEM private keys are redacted. Header *names* and JSON
  *keys* are kept — the API shape is preserved.
- `trace.zip`'s internal network log is **not** sanitized today.
  Treat `trace.zip` as sensitive when sharing or attaching to issues.
  (This is a known gap; see sekko's `STATUS.md`.)
- Extension-target network in `network-detail.json` *is* sanitized —
  same pipeline as HAR.
- `--no-sanitize` exists for the rare case where the user genuinely
  wants raw secrets (e.g., replaying against a sandbox API). Default
  to sanitization unless the user asks.

### Connect mode — when and how

Use `--connect` when:

- The target site detects Playwright-launched browsers (Cloudflare
  challenge that won't go away, fingerprint blocks, etc.)
- The user already has a working logged-in browser session they don't
  want to re-establish
- The user is developing against a Chrome instance with extensions
  already manually installed via `chrome://extensions`

The setup the user needs (one-time):

1. Launch Chrome Canary (or any Chrome) with `--remote-debugging-port=9222`
   AND `--user-data-dir=<dedicated-path>`. **Both flags are required;**
   Chrome refuses the debug port on the default profile.
2. Manually log into the target site once in Canary.
3. Verify: `curl http://127.0.0.1:9222/json/version` should print JSON.
4. From a separate terminal: `sekko record-web <url> --connect`.

Connect mode quirks:

- The recording is bounded by the tab sekko opens. Other tabs aren't
  recorded.
- No HAR file is written (sekko didn't create the browser context).
  Network is still in `trace.zip`.
- IPv4-only: use `127.0.0.1`, not `localhost` (Chrome's debug port
  doesn't listen on IPv6 by default; sekko auto-rewrites `localhost`
  to `127.0.0.1` for you).

### Extension testing — what each flag does

- `--load-extension <path>` — load unpacked extension(s); requires a
  persistent profile. Multiple paths comma-separated.
- `--system-screenshots` — switch screenshot source from Playwright
  page-area to system-level full-window screencapture (1Hz). Needed to
  see extension popups in screenshots (popups don't render inside the
  page DOM that Playwright sees).
- `--trace-extensions` — superset preset: turns on
  `--system-screenshots` AND captures network (with bodies) from
  popup/sidepanel/options/service-worker via CDP `Target.attachToTarget`.
  Tagged in `network-detail.json` with `origin: 'service-worker'` etc.

On macOS, `--system-screenshots` will prompt for Screen Recording
permission the first time. Grant it to the terminal app running sekko.

## Terminal: `sekko record-terminal`

### The shape

```bash
sekko record-terminal --output <dir> [flags]
```

An interactive shell opens (zsh preferred, bash if zsh isn't available;
override with `--shell bash`). The user runs commands. The session ends
on `exit` or Ctrl-D.

Shell hooks inject command-boundary markers so extraction can separate
each command's output, exit code, and duration. zsh uses
`preexec`/`precmd`; bash uses `PROMPT_COMMAND` + `DEBUG` trap.

### Output directory layout

```
<output>/
├── recording.cast         # asciicast v2 NDJSON + sekko boundary markers
└── voice-over.wav         # only with --narrate
```

### Common flag recipes

```bash
# Plain terminal session
sekko record-terminal --output ./sessions/build-walkthrough

# Force bash (if zsh hooks don't work for some reason)
sekko record-terminal --shell bash

# Narrated CLI tutorial with custom vocabulary
sekko record-terminal --narrate --keyterm "kubectl,terraform,helmfile"
```

### Security caveat for terminal recordings

**Input events captured in `.cast` include passwords typed at hidden
prompts** (sudo, ssh, anything reading from a TTY without echoing).
The terminal output doesn't show them, but the underlying input stream
does. Today this is an open question in sekko — see `STATUS.md`. If
the user is about to record a session that includes a sudo or ssh
password, surface this so they can decide.

Credential redaction at extract time covers common token shapes
(GitHub, AWS, Bearer/JWT, DB connection strings, basic-auth URLs) but
**not** typed passwords at hidden prompts.

## Stopping a Recording

Cleanest signals (all save the artifacts):

| Mode | Clean stop signals |
|------|---|
| Browser | Close the tab sekko opened; or Ctrl-C in the launching terminal |
| Terminal | Type `exit` or Ctrl-D |

If the user kills sekko hard (Ctrl-C from outside the terminal,
SIGKILL), the trace may be incomplete. The most common variant of this:
they Ctrl-C the *process* expecting it to save, when they should have
closed the *page* (browser mode) — Playwright's `context.tracing.stop()`
runs in the page-close handler, so closing the page is what triggers
the save.

## After Recording

Two things to do, in order:

1. **Transcribe** if `--narrate` was used and the user deferred at the
   prompt. See `extract-reference.md`.
2. **Extract** the recording. See `extract-reference.md`.

If the recording was a fresh `record-web --narrate` and the user said
"Y" at the post-recording transcription prompt, `narration.json` is
already written next to the audio — `extract` will pick it up
automatically.
