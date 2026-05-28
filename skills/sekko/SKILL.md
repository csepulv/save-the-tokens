---
name: sekko
description: Use when recording browser or terminal sessions with sekko (`sekko record-web`, `sekko record-terminal`), extracting them (`sekko extract`), transcribing voice-over narration, or when reading a sekko extract directory (containing `summary.md`, `actions.md`, `network.md`, `selectors.md`, `network-detail.json`, `screenshots/`, or `terminal-session.md`) to debug a UI, build a test suite, learn an unfamiliar app, or understand a CLI workflow.
---

# sekko

Sekko captures browser and terminal sessions and turns them into
agent-consumable markdown. This skill helps you drive sekko (record →
extract → transcribe) and helps you read sekko's output for downstream
work (bug repro, test building, UI/CLI learning).

This skill is **advisory**, not rigid. Match the depth to the task.

## When to use this skill

Trigger when one of these situations applies:

- The user mentions `sekko`, asks to record a session, or hands you a
  trace.zip / .cast file
- You're pointed at a directory containing `summary.md`, `actions.md`,
  `network.md`, `selectors.md`, `screenshots/`, `network-detail.json`,
  or `terminal-session.md`
- The user wants to debug a UI bug using a recorded session
- The user wants to build a test suite from a recorded golden path
- The user wants to learn an unfamiliar app or CLI from a recorded
  walkthrough
- The user wants to transcribe a voice-over narration

## Decide what you're doing, then load the reference

| Situation | Reference to read |
|---|---|
| Sekko not installed yet, or narration deps missing | `setup-reference.md` |
| User wants to record a session (browser or terminal) | `record-reference.md` |
| Recording exists; need to extract or transcribe it | `extract-reference.md` |
| Extract directory exists; need to read and use it | `consume-reference.md` |

Multiple may apply in sequence (setup → record → extract → consume).
Read only what's relevant to the current step.

## Common flows

### Flow 1: User wants to capture and use a session

1. Confirm sekko is installed (`sekko --version`). If not →
   `setup-reference.md`.
2. Pick `record-web` or `record-terminal` per the user's goal →
   `record-reference.md` for flag selection and output layout.
3. After the recording ends, if `--narrate` was used, transcribe (if
   not done inline) → `extract-reference.md`.
4. Extract → `extract-reference.md`.
5. Read the extract for the user's downstream goal →
   `consume-reference.md`.

### Flow 2: User points you at an existing extract

1. Read `summary.md` first — it tells you what's in the directory.
2. Pick the consume pattern that fits the user's goal — bug repro,
   test building, UI/CLI learning — from `consume-reference.md`.
3. If the recording is missing or incomplete, suggest a re-record
   with appropriate `record-reference.md` flags (e.g., they need
   network detail and didn't filter; they need extension popup
   state and didn't pass `--system-screenshots`).

### Flow 3: User has a recording but no extract yet

1. Confirm what's in the recording directory (`trace.zip` or
   `recording.cast`? `voice-over.wav` with or without
   `narration.json`?).
2. Transcribe first if needed, then extract →
   `extract-reference.md`.
3. Proceed to Flow 2.

## What this skill does NOT do

- **Install sekko or run sekko itself in the background.** Recording
  is interactive — the user drives the browser or terminal. You
  invoke the CLI commands; the user does the recording. Don't try to
  spawn a recording in a background shell.
- **Interpret correctness of captured behavior.** Sekko captures what
  the user did. Whether what they did was *right* requires the spec,
  the bug report, or the user's judgment.
- **Filter out sensitive data the user wanted captured.** Default
  sanitization is on; `--no-sanitize` is a deliberate user choice. If
  you see `--no-sanitize` and the recording includes sensitive
  endpoints, surface that as a question — don't just strip the data.
- **Replay sessions.** Sekko records; it doesn't replay. If the user
  wants automated replay, that's a Playwright test (which the consume
  patterns help you write) — not a sekko feature.

## When to escalate out of this skill

- **You need to actually drive a browser yourself** (verify a fix,
  visual QA on the developer side) → `/visual-qa` or use Chrome
  DevTools MCP / agent-browser directly. Sekko is for *user*
  sessions; visual-qa is for *agent* sessions.
- **You're authoring a Playwright test from scratch** rather than
  translating a recording → use sekko output as input, but the test
  authoring itself is outside this skill.
- **The recording is failing for non-sekko reasons** (Chromium
  doesn't launch, microphone access denied, Deepgram API down) →
  surface the underlying issue; sekko is a tool, not a fix for its
  environment.

## Reading material outside this skill

When you need more detail than the references here:

- `tools/sekko/README.md` (in the repo) — comprehensive flag tables,
  troubleshooting, env-var reference, and sanitization specifics,
  including the note that `trace.zip`'s internal network log is **not**
  sanitized today (treat it as sensitive when sharing recordings)
- `tools/sekko/sekko.config.yaml.example` — config file shape for
  persistent extract filters
