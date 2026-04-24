# Inspect mode

One-target enumeration. For orientation on a single page — reading
structure before making edits, or verifying structure after them.
No pair, no delta, no report.

Capture + prepare + review form the two-session comparison workflow.
Inspect sits outside that pipeline — it's the "just look at one page"
lane.

## When inspect mode fires

Trigger phrases:
- "show me the regions on this page"
- "map the regions on this page"
- "enumerate this URL"
- "what's the DOM structure of <page>"
- "get me the overlay for <url>"
- "let's look at this page"

If the user has a reference in mind and wants comparison, that's
capture mode — ask before starting.

## Inputs to gather from the user

Before running the script, confirm:

1. **URL or absolute file path.** The one target.
2. **Optional: viewport / scope / maxDepth overrides.** Defaults are
   `1280×633`, scope `body`, `maxDepth=4`. Ask only if the user
   indicated a non-default need.
3. **Optional: output directory.** Default: `.visual-rosetta-maps/`
   (hidden dir to keep the workspace clean; artifacts are regenerable).

No session name needed — no pair structure to organize.

## Flow

1. Confirm the target URL/path with the user.
2. Invoke `enumerate.sh`:
   ```bash
   ./skills/visual-rosetta/scripts/enumerate.sh <url-or-file> body 4 .visual-rosetta-maps
   ```
3. Verify the outputs exist: `.json`, `.png`, `-overlay.png`,
   `-annotated.png`, `.txt`. The script's own post-condition checks
   handle most failures; if it reports success but the overlay PNG
   looks empty or misaligned, flag it.
4. Show the user:
   - The overlay PNG path (primary deliverable — this is what couples
     visual to DOM)
   - The framework fingerprint from the JSON
5. Brief sanity check — is this the page they meant?

## Iterating on the same page

If the user edits the page and wants to re-inspect, just re-run.
`enumerate.sh` produces fresh timestamped artifacts each run; the
latest overlay reflects the current DOM.

Re-running is often the fastest sanity check after edits that may have
shifted structure (not just style).

## What inspect mode does NOT do

- Compare to a reference — that's capture mode. If the user now wants
  to compare, suggest switching: "we already have one target; we need
  the reference."
- Produce an observation report — that's capture mode.
- Package for handoff — that's prepare mode.
- Prescribe fixes — no mode of this skill does this. Fix judgment is
  the user's (or a remediation session's).

## Done criteria

- Overlay PNG produced and shown to the user
- Framework fingerprint reported
- User has eyeballed it; no further inspection requested
- If the user now wants a comparison, suggest capture mode (the
  current target becomes one side of the pair)
