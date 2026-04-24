---
name: visual-rosetta
description: Map the visual regions of a rendered web page to their DOM subtrees — for orientation on a single page, or to compare a reference against an implementation and surface structural mismatches that CSS tweaks cannot fix. Four modes — inspect (enumerate one page to see its regions), capture (gather artifacts for a pair), prepare (package for handoff), review (consume a package and run a remediation discussion). Triggers on "show me the regions on this page", "map the regions on this page", "enumerate this URL", "what's the DOM structure here", "compare this reference to the implementation", "why doesn't my Astro/Starlight site match the design", "the padding is off but CSS tweaks aren't working", "review this rosetta package", "package this for handoff".
---

# visual-rosetta

Couples what a user sees on a rendered web page to the DOM behind it.
Produces region maps with overlay PNGs (red outlines for top-level regions,
purple for sub-regions), mechanical comparison deltas between pages, and
agent-authored observation reports — **observational only, no prescriptions**.

The skill has four modes:

1. **Inspect** — enumerate one page to see its regions (standalone)
2. **Capture** — enumerate targets, compare pairs, author observation reports
3. **Prepare** — package the results for handoff (portable directory + manifest)
4. **Review** — consume a package and run a remediation discussion with the user

Inspect is standalone — single target, no pair, no report. For orientation
on the current page before edits or verification after them.

Capture + prepare + review form a two-session comparison workflow: capture
+ prepare run in one session (session A); the receiving session runs review
(session B). The package is the bridge.

## When to use

- Comparing a design reference (static HTML, Claude Design output, etc.) to a
  live or in-progress implementation
- Layout is off and CSS-only attempts have failed — a sign of structural
  mismatch (grid vs. flex, wrong nesting, extra wrappers)
- Handing a design across stacks (static HTML → Astro, Figma export → React) and
  the implementation doesn't match
- A teammate handed you a `visual-rosetta` package and wants you to run the
  remediation discussion

## When NOT to use

- Single isolated layout bug on one page — DevTools is faster
- Pixel-level visual regression — use Percy, Chromatic, or similar
- Component-level comparison when the design already lives in Storybook —
  use `@storybook/addon-measure`

## Prerequisites

- `agent-browser` ≥ 0.23.0 on PATH ([install](https://agent-browser.dev))
- Chrome installed via `agent-browser install` (one-time)
- `jq` on PATH (JSON envelope unwrapping and post-condition validation)
- `node` ≥ 22 on PATH (`compare.js` is ESM)
- For `file://` references, the wrapper passes `--allow-file-access` automatically
- For JSX/framework references, the user runs their own dev server first

## Modes

### Inspect

Enumerate a single page — produce its region map, overlay PNG, and
framework fingerprint. For orientation on the current page: reading
structure before edits, or verifying structure after them. No pair,
no delta, no report.

Trigger phrases: *"show me the regions on this page"*, *"map the
regions on this page"*, *"enumerate this URL"*, *"what's the DOM
structure here"*, *"get me the overlay for <url>"*.

**Read `references/inspect.md`** for inputs, flow, and done criteria.

Scripts invoked: `scripts/enumerate.sh` (once per run; re-run for
iteration).

### Capture

Gather enumeration artifacts for one or more targets and — if the user wants
comparisons — produce delta JSONs and authored observation reports for each
pair.

Trigger phrases: *"capture the reference and the implementation"*,
*"enumerate these pages"*, *"run visual-rosetta capture"*, *"compare this
reference to my implementation"*.

**Read `references/capture.md`** for the per-target / per-pair flow, the
working-directory layout, and the done criteria. While authoring observation
reports, also read `references/observation-report.md` — it's the authoritative
source for tone rules, required sections, and the forbidden-term list.

Scripts invoked: `scripts/enumerate.sh` (per target), `scripts/compare.sh`
(per pair).

### Prepare

Assemble the capture artifacts into a portable package — a directory
(optionally zipped) with a `manifest.md` index and a fallback `README.md` for
recipients without the skill.

Trigger phrases: *"prepare this for handoff"*, *"package this"*, *"run
visual-rosetta prepare"*, *"wrap it up for review"*.

**Read `references/prepare.md`** for the package layout, what goes in the
manifest and fallback README, and the done criteria.

### Review

Consume a `visual-rosetta` package and run a remediation discussion — walk
the open questions from the observation report, read the target's layout
primitives, propose options with asymmetry-aware justification, implement,
verify via re-capture.

Trigger phrases: *"review this package"* with a path, *"run visual-rosetta
review"*, *"help me reconcile these gaps"*, or the user drops a `.zip` /
package-directory path.

**Read `references/review.md`** for the five-step flow (walk questions →
read primitives → propose → implement → verify) and the list of anti-patterns
to avoid. Step 2 (read primitives) is the failure-mode protection and is
mandatory, not optional.

## Mode dispatch

If the user's intent is unambiguous from their message or the artifacts they
provide, enter that mode directly and read the corresponding reference doc.

If intent is ambiguous, ask:

> "Inspect (one page, see its regions), capture (gather a pair for comparison),
> prepare (package a capture for handoff), or review (consume a package I've
> been handed)?"

Inspect is standalone. A typical session A runs capture then prepare. A
typical session B runs review alone.

## Behavior notes (technical)

These are internals of the enumeration pipeline that affect capture-mode
output. Good to know when debugging weird artifacts.

- **Always starts at page top.** `enumerate.sh` scrolls to `(0, 0)` after
  page load. URL fragments (`#section-id`) still navigate, but scroll state
  is forced back to top so sticky/fixed elements are measured at their
  at-rest positions. Without this, `getBoundingClientRect + scrollY` puts
  sticky headers mid-document.
- **Full-page screenshots reflect captured scroll state, not a fresh layout.**
  Chrome's `captureBeyondViewport` draws sticky/fixed elements at their
  "stuck" position during capture. The scroll-to-top step is the mechanism
  that keeps this consistent across runs with or without URL fragments.
- **Zero-bbox wrappers are walked through, not emitted.** Frameworks like
  Starlight render `nav.sidebar` with `height: 0` and a visible
  `div.sidebar-pane` child; the walk descends so real descendants surface.
- **Class-name selectors are escaped via `CSS.escape()`.** Tailwind colons
  (`lg:flex`), scoped-hash patterns (`astro-<hash>`), and other
  non-identifier characters get escaped so selectors are valid for
  `document.querySelector`.
- **agent-browser daemon state is not assumed.** `enumerate.sh` closes any
  running session before opening the URL. A stale daemon silently ignores
  new global flags (e.g. `--allow-file-access`) with only a stderr warning.
- **Exit 0 is not success.** `agent-browser` returns 0 even on internal
  failures (screenshots that didn't land, eval errors folded into the
  envelope). `enumerate.sh` validates output files exist and `jq -e`s the
  emitted JSON before reporting success.

## Scoring and fingerprint internals

- `references/heuristics.md` — region scoring weights and tuning guide
- `references/fingerprint.md` — framework-detection rule set

## What this skill does NOT do

- Render the page (agent-browser does that)
- Prescribe remediations, prioritize gaps, or classify deltas as
  "structure-solvable" vs "style-solvable" (the observation report is
  observational; classification is a judgment made during review mode)
- Fix layout issues automatically (review mode proposes options; the
  user decides; implementation is by hand with verification via re-capture)
- Write the `handoff` baton (the `handoff` skill does that)
