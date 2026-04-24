# Capture mode

Capture mode iterates with the user to enumerate one or more visual targets
(reference, implementation, variants) and — if the user wants comparisons —
produces delta JSONs and agent-authored observation reports per pair.

Capture is the data-gathering phase. Prepare (next mode) packages the
results for handoff; review (the mode that opens on the other side)
consumes a package and runs a remediation discussion.

## When capture mode fires

Trigger phrases:
- "let's capture the reference and…"
- "run visual-rosetta capture"
- "enumerate these pages"
- "compare this reference to my implementation"

If the user's intent is ambiguous between capture / prepare / review, ask
before starting.

## Inputs to gather from the user

Before running any script, confirm:

1. **Session name** (short slug). Used for the default working dir
   (`./rosetta-work/<name>/`) and eventually the package name. Ask if
   the user didn't supply one.
2. **Targets.** Two or more — usually reference + implementation, but
   can be more (e.g. `ref + m1 + m2` for tracking iterations over time).
   For a single target, use inspect mode instead (`references/inspect.md`).
   For each target, get:
   - A human label (e.g. `reference`, `m2`, `impl-after-header-fix`)
   - The URL or absolute file path
   - Anything the user wants the agent to note about it (annotations
     pass through to the manifest in prepare mode)
3. **Pairs to compare.** Most common: every non-reference target
   against the reference. But the user may want other pairings (e.g.
   `m1 vs m2` to track progress). If not stated, propose pairing
   every target against the reference and confirm.
4. **Optional: viewport or scope overrides.** Default is viewport
   `1280×633`, scope `body`, `maxDepth=4`. Ask only if the user
   indicated a non-default need.

## Default working directory

```
./rosetta-work/<session-name>/
├── <label-1>/         e.g. reference/
│   └── (enumerate.sh outputs for that target)
├── <label-2>/         e.g. implementation/
│   └── (enumerate.sh outputs)
└── comparisons/
    ├── <ref-label>-vs-<impl-label>.delta.json
    └── <ref-label>-vs-<impl-label>.report.md
```

Each target-label directory holds that target's enumeration artifacts
with their native filenames (slug-and-timestamp from `enumerate.sh`).
This keeps names stable and human-readable; prepare mode picks from
here.

## Flow per target

For each target the user named:

1. Confirm the target's label and URL/path with the user.
2. Invoke `enumerate.sh`:
   ```bash
   ./skills/visual-rosetta/scripts/enumerate.sh <url-or-file> body 4 ./rosetta-work/<session>/<label>
   ```
3. Verify the outputs exist: `.json`, `.png`, `-overlay.png`,
   `-annotated.png`, `.txt`. The script's own post-condition checks
   handle most failures; if it reports success but the overlay PNG
   looks empty or misaligned, flag it before proceeding.
4. Show the user the overlay PNG path and the framework fingerprint
   from the JSON. Brief sanity check — is this the page they meant?

## Flow per pair (after all targets are enumerated)

For each `<ref, impl>` pair the user confirmed:

1. Find the latest JSON in each target's directory.
2. Invoke `compare.sh`:
   ```bash
   ./skills/visual-rosetta/scripts/compare.sh \
     <ref-json> <impl-json> \
     ./rosetta-work/<session>/comparisons \
     <ref-label>-vs-<impl-label>
   ```
3. The script emits `<stem>.delta.json`.
4. Author `<stem>.report.md` in the same directory. Read
   `references/observation-report.md` first — it is the authoritative
   source for section structure, tone rules, and the forbidden-term
   list. Save the report alongside its delta JSON.

## What capture mode does NOT do

- Package the results. That's prepare mode's job; prepare picks from
  the working dir and assembles the portable package.
- Start a remediation discussion. That's review mode's job, consuming
  a package handed off from prepare.
- Prescribe fixes. The observation report is observational. Read
  `references/observation-report.md` for tone rules. If the agent is
  tempted to classify deltas as structure-solvable / style-solvable,
  re-read the one principle at the top of that doc.

## Done criteria

- Every named target has a complete set of enumeration artifacts
- Every requested pair has both a `.delta.json` and a `.report.md`
- Reports pass the B.1 tone preflight (no forbidden terms; hypotheses
  framed with "suggests"/"may indicate"; questions are genuine)
- User has eyeballed the overlays and confirmed the enumerations look
  sensible
- User is ready to move to prepare mode (or explicitly says "we're
  not packaging, I just wanted to look")

Once done, suggest: *"ready to prepare this for handoff, or do you
want to inspect the artifacts first?"*
