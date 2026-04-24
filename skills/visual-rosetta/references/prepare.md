# Prepare mode

Prepare mode assembles the artifacts gathered in capture mode into a
portable package — a directory (optionally zipped) that a downstream
session can open in review mode and work from directly.

## When prepare mode fires

Trigger phrases:
- "prepare this for handoff"
- "package this"
- "run visual-rosetta prepare"
- "wrap it up for review"

Usually follows a capture-mode session. If the user jumps into prepare
without a visible capture run, confirm what working dir (or arbitrary
file set) they want packaged.

## Inputs to gather from the user

1. **Source working dir.** Defaults to `./rosetta-work/<session>/`
   from the most recent capture. If multiple capture sessions are on
   disk, ask which one. Verify the dir has at least one target and
   at least one comparison pair.
2. **Package name.** Defaults to `<session>-<YYYYMMDD-HHMMSS>`.
   User may override (e.g. if shipping multiple packages from one
   capture session).
3. **Output location.** Defaults to `./rosetta-packages/`. User may
   override (`~/Downloads/claude-inbox/` is a common choice for
   hand-off).
4. **Which pairs go in the package.** A capture session may have
   N pairs; the user may want to ship only the subset that matters
   for this hand-off. Default: ship all pairs. Confirm if ambiguous.
5. **Zip?** Default no. Ask if the user is moving the package to
   another machine or sending it somewhere.

## Package layout

```
<package-name>/
├── manifest.md                    — human-readable overview
├── README.md                      — fallback instructions for recipients without the skill
├── reference/                     — reference target's artifacts
│   ├── <map>.json
│   ├── <map>.png                  — plain screenshot
│   └── <map>-overlay.png          — region overlay (the primary visual deliverable)
├── implementation/                — impl target's artifacts (or <label>/ if named differently)
│   └── ...
├── <additional-target-labels>/    — one dir per target, named by the capture-time label
└── comparisons/
    ├── <ref>-vs-<impl>.delta.json
    └── <ref>-vs-<impl>.report.md
```

One directory per target, using the capture-time label. One pair of
files per comparison in `comparisons/`. Keep enumeration filenames
as-is (slug-and-timestamp from `enumerate.sh`); this makes the
package self-describing and diff-able across versions.

## What goes in `manifest.md`

Human-readable index. Minimum content:

- **Package name and generation timestamp**
- **Session name** from capture
- **Targets table** — one row per target:
  - Label
  - URL / file path captured
  - Framework fingerprint (from the region-map JSON)
  - Viewport size
  - Timestamp of capture
  - Any notes the user provided during capture
- **Comparisons table** — one row per pair:
  - Pair name
  - Matched-pair count and confidence distribution
  - Unmatched-region count (per side)
  - Key cross-cutting observations (bbox-overlap flag, framework
    difference, etc.) — one-liner each
- **Next step** — explicit pointer to `README.md` for users who don't
  have the skill, or an invitation to run
  `visual-rosetta review <package-path>` if they do.

The manifest is an index, not a summary. Lists what's in the package
and how to use it. Does not re-state the observations.

## What goes in `README.md` (fallback)

Synthesized from `references/review.md` with the package's actual paths
substituted in. This is the fallback for recipients whose sessions do
not have `visual-rosetta` installed.

Structure:

1. One paragraph: what this package is, and where it came from.
2. File list with absolute paths (same paths as manifest):
   - Observation report(s) — the main input
   - Delta JSON(s)
   - Reference overlay PNG
   - Implementation overlay PNG
3. The instruction body from `references/review.md` — the five-step
   "walk open questions → read primitives → propose with
   asymmetry-aware justification → implement → verify" sequence. Copy
   it verbatim; it is the canonical review workflow. Substitute the
   real paths for the file-list placeholders.

A recipient with the skill installed can skip the README and say
"run visual-rosetta review on this package" to get the same flow —
but the README is a belt-and-suspenders fallback.

## Flow

1. Confirm inputs with the user (source working dir, package name,
   output location, pair subset, zip?).
2. Create the package directory.
3. Copy each target's artifacts into `<package>/<label>/`. Preserve
   filenames. Do NOT copy intermediate files like `.txt` legends or
   `-annotated.png` (agent-browser's interactive-element overlay) —
   those are enumeration byproducts, not review-relevant.

   Actually: do copy them. They don't cost much space and a
   detail-seeking reviewer may want them. Exception: if the user asks
   for a minimal package, drop `.txt` and `-annotated.png`.
4. Copy each comparison's `.delta.json` and `.report.md` into
   `<package>/comparisons/`.
5. Generate `manifest.md` per the section above.
6. Generate `README.md` per the section above.
7. If the user asked to zip: `zip -r <package>.zip <package>/` from
   the output location.
8. Report back:
   - Package path (absolute)
   - Contents summary (N targets, M pairs)
   - What the user's next step is (hand to someone / open review
     mode elsewhere)

## Done criteria

- Package directory exists at the stated output location
- Manifest lists every target and pair
- README contains the review instructions with real paths
  substituted in (no placeholders left)
- Every artifact referenced in the manifest exists in the package
- If zip was requested, `.zip` exists alongside the directory

Once done, suggest: *"package at `<path>`. Hand to the recipient, or
open it in review mode yourself with a fresh session."*
