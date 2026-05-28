# Consuming a sekko Extract

You've been pointed at a sekko extract directory (or a `trace.zip` /
`.cast` that you can extract). Sekko's job is to *present* the session
cleanly. Your job is to *interpret* it.

This reference covers:

1. What's in the extract — file inventory and how the pieces fit
2. How to navigate the artifacts efficiently (token-cheap reading order)
3. Patterns — recipes for downstream tasks (bug repro, test building,
   UI/CLI learning)

## File Inventory

**Always start by reading `summary.md`.** It's a manifest sekko writes
to tell you what was captured and in what order to read it. It also
notes which screenshot source was used (Playwright page-area vs.
system-level full-window) and gives you network counts broken down by
origin (page / popup / sidepanel / service-worker / options).

The other files, by recording type:

### Browser extract (`record-web` → `extract`)

| File | What it holds | Read it when |
|------|---------------|--------------|
| `summary.md` | Manifest + reading-order guide | **First, every time.** |
| `actions.md` | Chronological user actions (clicks, fills, navigations) with selectors and the IDs of network requests each action triggered. Each row references a screenshot. | Understanding what the user did, in what order, and on what page. |
| `network.md` | HTTP request summary table — ID, method, URL, status, action ref. Adds an Origin column when extension targets are present. | Scanning the API surface; finding which requests matter. |
| `network-detail.json` | Full request/response bodies keyed by ID. | When you need a specific request's payload, headers, or response shape. **Don't read top-to-bottom; index by ID from `network.md`.** |
| `selectors.md` | Unique selectors for every interactive element touched. | Writing tests; understanding what's clickable. |
| `screenshots/` | `action-NN.jpeg` per action. With `--system-screenshots` or `--trace-extensions`, these are full-window (browser chrome + extension popups); otherwise page-area. Some have suffixes: `-popup.jpeg`, `-sidepanel.jpeg`, `-options.jpeg`. | Confirming visual state; understanding what the user saw at a moment. |
| `narration.md` | Timestamped voice-over transcript. Only present if the user ran `--narrate` AND transcription finished. | Understanding intent — *why* the user did each thing, in their own words. |

### Terminal extract (`record-terminal` → `extract`)

| File | What it holds | Read it when |
|------|---------------|--------------|
| `summary.md` | Manifest. | First, every time. |
| `terminal-session.md` | Every command, its output, exit code, and duration. Credentials redacted, interactive programs (vim, less) noted, long output truncated. | Following the actual shell flow as a human would. |
| `terminal-session.json` | Same data, structured. Better for filtering/grepping. | When you need to programmatically find commands by exit code, name, or pattern. |
| `narration.md` | Voice-over transcript. Same as browser. | Understanding intent behind each command. |

## How to Navigate Efficiently

Two failure modes to avoid:

1. **Reading `network-detail.json` linearly.** It can be megabytes. Always
   pick request IDs from `network.md` first, then look those IDs up.
2. **Eyeballing screenshots one-by-one.** Screenshots are JPEGs — viewing
   each costs context tokens. Use them surgically: confirm a specific
   action's visual state, not as the primary discovery surface.

**The recommended reading order for any new extract:**

```
summary.md                       (orient — what's here, what to look at)
narration.md                     (if present — what was the user trying to do?)
actions.md                       (the spine of the session)
network.md                       (API surface scan)
network-detail.json[#id]         (only the entries actions.md references)
selectors.md                     (when generating tests or interaction code)
screenshots/action-NN.jpeg       (confirm a specific moment when needed)
```

For terminal extracts, swap `actions.md`/`network.md` for
`terminal-session.md` (the structured `.json` is for programmatic
filtering, not for reading top-to-bottom).

## Cross-References — How the Files Fit

- **Actions → Network.** Each action in `actions.md` lists the IDs of
  network requests it triggered (page-network only — service-worker
  entries are event-driven and don't correlate to user actions). The IDs
  reference rows in `network.md` and entries in `network-detail.json`.
- **Actions → Screenshots.** Each action references its screenshot
  filename (`screenshots/action-NN.jpeg`). When system screenshots are
  in use, you may also see `action-NN-popup.jpeg` for extension popups.
- **Narration → Actions.** Narration is **standalone, not inline.** The
  transcript is timestamped; cross-reference timestamps against
  `actions.md` yourself. Don't assume a narration line at T+12s maps
  one-to-one with the action at T+12s — narrators say "I'm about to
  click" or "as you saw earlier" and the alignment is interpretive.
- **HAR vs trace.zip network.** `recording.har` is sanitized by default;
  `trace.zip`'s internal network log isn't (today). For extension
  targets, `network-detail.json` *is* sanitized — same pipeline as HAR.

## Patterns

The three primary downstream uses. Each is a recipe, not a script —
adapt to the actual extract in front of you.

### Pattern: Bug repro from a trace

**Goal:** A user reported a bug. They recorded a session of the bug
happening. You need to reproduce it, understand it, and ideally fix it.

1. **Read `narration.md` first** if present — the user often describes
   the bug verbally ("I clicked save and nothing happened", "this
   number is wrong"). The bug is usually named there.
2. **Read `actions.md`** to find where the user's flow diverged from
   expected. The last few actions before the symptom are the focus.
3. **For the suspect action, pull its network requests.** From
   `actions.md`, get the request IDs; look them up in `network.md`
   (status code, URL) and `network-detail.json` (payload, response).
   Failed requests (4xx/5xx) jump out in `network.md`.
4. **Look at the screenshot for the suspect action** — does the visual
   state match what `actions.md` claims happened? Mismatches surface
   render bugs.
5. **Now write the failing test.** Use selectors from `selectors.md`
   for the bug-relevant elements. The actions log gives you the steps;
   the network detail gives you what the API returned (mock it or fix
   the server). The screenshot is your visual assertion.

### Pattern: Build a test suite from a session

**Goal:** A user recorded a "golden path" through the app. You want to
turn it into an automated acceptance test (Playwright, Cypress, etc.).

1. **`actions.md` is your script.** Each row is a step in the test.
2. **`selectors.md`** is your locator catalogue — use these exact
   selectors so the test stays robust to surrounding-DOM changes.
3. **`network.md`** tells you what the test should expect: which
   endpoints get hit, in what order, with what status codes. Decide
   per request: assert (call really happened), mock (return canned
   data), or ignore (analytics, telemetry).
4. **`network-detail.json`** gives you request shapes for the mocks
   and response shapes for the assertions.
5. **`narration.md`**, if present, is the test plan — the user often
   says "now I'm checking that…" which maps to a test assertion.
6. **Screenshots become visual regression baselines** if your test
   framework supports them. Otherwise, use them to author DOM-level
   assertions (text content, presence of elements).
7. **Don't ship a 1:1 translation.** Sekko captures everything; tests
   should be focused. Drop the navigations that aren't on the critical
   path; collapse adjacent fills into single setup steps.

### Pattern: Learn a UI or CLI you've never used

**Goal:** You're working in a brownfield codebase. The user recorded
themselves using the app. You need to know what the app does, how it's
laid out, what flows exist, and what API surface backs it.

1. **`summary.md` first** for the breadth — how many actions, how many
   endpoints, was narration captured.
2. **`narration.md`** for the user's mental model — they describe the
   app in their own words.
3. **`actions.md`** as a tour. Scan, don't read. Look for navigation
   actions to map page-to-page transitions.
4. **`network.md` grouped by host/path prefix** gives you the API
   shape: which services the app talks to, which endpoints exist.
   Endpoints that appear multiple times are likely the hot paths.
5. **`selectors.md`** as a vocabulary — what the team names things
   (testids, ARIA labels). This often reveals the mental model the
   developers had.
6. **Screenshots, surgically.** Look at one screenshot per distinct
   page you found in `actions.md` to get the layout — then put them
   away.
7. **For a terminal extract**, replace `actions.md` with
   `terminal-session.md` — the sequence of commands is the workflow.
   Commands with non-zero exit codes are signals (the user hit a
   problem and recovered, or didn't).

## What This Skill Does NOT Tell You

- **Whether the captured behavior is correct.** Sekko captures what
  happened; *whether what happened was right* requires the human's
  judgment, the spec, or the bug report.
- **What's missing.** A trace shows what the user did; it can't show
  what they didn't do. If the recorded flow doesn't include an edge
  case you care about, you need another recording — or a different
  approach.
- **API patterns or semantic dedup.** Sekko deliberately doesn't
  interpret network requests beyond filtering by host. Your judgment
  decides what's a real call vs. analytics noise.
