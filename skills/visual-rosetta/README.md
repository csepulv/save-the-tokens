# visual-rosetta

Map the visual regions of a rendered web page to their DOM subtrees,
fingerprint the framework, and compare a reference page against an
implementation to produce a facts-only observation report.

Ships as a Claude Code skill (`visual-rosetta`) or as plain CLI scripts
that run standalone. Both paths share the same code; pick whichever
fits your workflow.

> **DISCLAIMER / PSA:** Shared as-is, I hope it helps. This space is
> evolving quickly. I am sharing to help others wade through the fog and
> swamp, as I have been doing. Look around; there are probably better
> tools than this one. 😉

---

## What it does

- **Enumerate regions.** Walk a page's DOM, score each element for
  "region-likeness" (ARIA landmarks, semantic tags, layout, size), and
  emit a ranked tree of candidates with bounding boxes and computed
  styles.
- **Render the map.** Produce a full-page screenshot plus an
  **overlay PNG** with red outlines for top-level regions and purple
  outlines for their children. Makes structural issues visible at a
  glance — overlapping red outlines are typically diagnostic.
- **Fingerprint the framework.** Detect Starlight / Astro / React+Chakra
  / plain from DOM evidence. Stored in the region-map JSON for
  downstream consumers.
- **Compare two pages.** Match regions across a reference and an
  implementation, emit a delta JSON with matched pairs, unmatched
  regions, and cross-cutting observations (bbox overlap, display
  primitive distribution, width-sum patterns).
- **Author a facts report.** A downstream Claude Code session (or a
  human) authors an observation markdown report from the delta —
  observational only, no prescriptions. See
  `references/observation-report.md`.

---

## Prerequisites

- **[agent-browser](https://agent-browser.dev)** ≥ 0.23.0 on PATH
  (`npm install -g agent-browser` or `brew install agent-browser`)
- **Chrome** installed via `agent-browser install` (one-time)
- **jq** on PATH (`brew install jq` or apt/yum equivalent)
- **Node** on PATH (22+; needed for `compare.js`)

---

## Install as a Claude Code skill

The source of truth is `skills/visual-rosetta/` in this repo.
`~/.claude/skills/visual-rosetta/` is a cache maintained by whatever
sync process you use. A one-shot mirror:

```bash
rsync -a --delete skills/visual-rosetta/ ~/.claude/skills/visual-rosetta/
```

Verify with:

```bash
~/.claude/skills/visual-rosetta/scripts/enumerate.sh --help
```

Invoke from a Claude Code session. The skill has four modes:

- **Inspect** — enumerate one page to see its regions. For orientation
  before making edits, or verifying structure after them. Standalone —
  no pair, no delta, no report. *"Show me the regions on this page."*
- **Capture** — gather enumeration artifacts for one or more targets
  (reference, implementation, variants) and author observation reports
  for each pair. *"Let's capture the reference and my implementation."*
- **Prepare** — package the capture results for handoff (portable
  directory + manifest + fallback README). *"Package this for review."*
- **Review** — consume a package and run a remediation discussion —
  walk the open questions, read the target's layout code, propose
  options, implement, verify via re-capture. *"Review this package at
  `/path/to/pkg`."*

Inspect is standalone. Capture + prepare typically run in one session
(session A); review runs on the other side, in a fresh session handed
the package (session B). See `SKILL.md` and
`references/{inspect,capture,prepare,review}.md` for each mode's
workflow.

---

## Use the scripts directly

You can run the scripts without installing the skill or using Claude
Code. They're standalone CLI tools.

### Enumerate a page

```bash
./skills/visual-rosetta/scripts/enumerate.sh <url-or-file> [scope] [max-depth] [out-dir]
```

Examples:

```bash
# Default: scope body, depth 4, output ./region-maps/
./skills/visual-rosetta/scripts/enumerate.sh https://example.com

# Local file (URL is rewritten automatically)
./skills/visual-rosetta/scripts/enumerate.sh /path/to/reference.html

# Drill into a region from a prior pass
./skills/visual-rosetta/scripts/enumerate.sh https://example.com 'nav.sidebar' 3

# Custom output directory
./skills/visual-rosetta/scripts/enumerate.sh https://example.com body 4 ./out
```

Produces in the output directory:

- `<slug>-<timestamp>.json` — region-candidate tree + framework fingerprint
- `<slug>-<timestamp>.png` — full-page screenshot
- `<slug>-<timestamp>-overlay.png` — screenshot with red/purple region outlines
- `<slug>-<timestamp>-annotated.png` + `.txt` — agent-browser's own
  interactive-element annotation (for AI navigation; not the region map)

Quick peek at the JSON:

```bash
jq '.framework, [.candidates[] | .selector]' region-maps/<latest>.json
```

### Compare two region maps

```bash
./skills/visual-rosetta/scripts/compare.sh <ref-map.json> <impl-map.json> [out-dir] [name-stem]
```

Examples:

```bash
# Default: out ./comparisons/, auto-named compare-<timestamp>.delta.json
./skills/visual-rosetta/scripts/compare.sh ref.json impl.json

# Stable-named output
./skills/visual-rosetta/scripts/compare.sh ref.json impl.json ./out ref-vs-impl
```

Produces `<out-dir>/<name-stem>.delta.json` containing:

- `matchedPairs` — paired regions with confidence tier and attribute diffs
- `unmatched` — regions present on one side only
- `observations` — cross-cutting findings (bbox overlap, primitive
  distribution, width sums, scoped-class presence, framework difference)

### What the scripts don't do

- Author the markdown observation report — that's agent-authored from
  the delta, guided by `references/observation-report.md`. You can do
  this yourself in any LLM session, or in Claude Code with the skill
  installed.
- Prescribe fixes, prioritize gaps, or recommend changes. Those are
  judgment calls for a remediation session; the tool produces facts.
- Render pages (`agent-browser` does that).

---

## What the delta surfaces

The comparison matches regions across the two maps using a four-tier
heuristic (selector → role+aria-label → semantic-tag-singleton →
tag+quadrant+aspect). For each matched pair, the delta surfaces
differences like:

- Reference body region: `display: grid`, `grid-template-columns: 240px 727px 220px`
- Implementation body region: `display: block`, full viewport width

That kind of structural mismatch is exactly what CSS tweaks cannot fix —
and exactly what the delta JSON + observation report make visible.
