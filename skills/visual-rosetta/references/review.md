# Review mode

Review mode consumes a `visual-rosetta` package (produced by prepare
mode) and runs a remediation discussion with the user — walk open
questions, read the target's layout code, propose options, implement,
verify.

This is the session-B half of the workflow. The package arrives from
somewhere else (another session, another machine, a teammate).

## When review mode fires

Trigger phrases:
- "review this package" + a path
- "run visual-rosetta review"
- "help me reconcile these gaps"
- user drops a `<name>.zip` or package directory path

If the path isn't obviously a visual-rosetta package, verify before
starting: the dir or zip should contain `manifest.md`, at least one
target subdirectory, and a `comparisons/` folder.

## Inputs to gather

1. **Package path.** Absolute path to the package directory. If the
   user dropped a zip, unzip it (or ask the user to) and confirm the
   extracted directory.
2. **Implementation codebase path.** The target's source code
   directory. Absolutely essential. If the user doesn't supply it,
   ask — do not proceed without it (step 2 below requires it).
3. **Scope confirmation.** Some packages contain multiple comparison
   pairs (e.g. ref-vs-m1 + ref-vs-m2). If more than one, ask which
   pair the user wants to focus on.

## Flow — five steps, in order. Do NOT skip.

### Step 1 — Walk the open questions with the user

Read the `.report.md` for the selected pair. The report has an
**Open questions** section. These are the hinges of the remediation
discussion.

One question at a time. For each, present the question as the report
phrases it. The user answers:

- **"target"** — the difference matters; we close the gap
- **"acceptable"** — the variance is fine; move on
- **"depends on X"** — needs discussion before classification

Log each answer. Do NOT propose fixes in this step. The goal is to
agree on which gaps are in scope before proposing how to close them.

### Step 2 — Read the target framework's layout primitives

Before proposing any CSS or structural change, read the implementation
codebase. Specifically:

- What component renders the page shell?
- How are the header, sidebar, and main content positioned?
  Fixed / sticky / flow? This distinction is the source of most
  remediation failures.
- What's the customization surface — theme tokens, component
  overrides, slots, or raw CSS?
- What positioning CSS is authored upstream that the target has
  inherited or overridden?

This step is mandatory, not optional. Fixes that ignore the target's
actual layout code are the failure mode this workflow exists to
prevent — without reading the layout source, remediation devolves into
iterating on CSS until the overlay looks close, never achieving the
structural fix the observation report called out.

If the framework fingerprint in the manifest is known (Starlight,
Astro, React+Chakra), the relevant files to read are usually:

- **Starlight**: `PageFrame.astro`, `Page.astro`, theme stylesheets,
  any user customizations in `astro.config.mjs` under `starlight.overrides`
- **Astro (non-Starlight)**: the layout files under `src/layouts/`,
  any `<style>` blocks in them
- **React + Chakra**: theme files (usually under `src/theme/`), layout
  components, any global CSS
- **Unknown / plain**: the user's layout CSS, inline styles, and
  component trees that render the regions in question

Do not guess. Read the files.

### Step 3 — Propose options with asymmetry-aware justification

For each gap the user marked "target" in step 1:

- Propose a concrete fix. Name the file(s) to change and the shape
  of the change (not the exact CSS yet — that's step 4).
- **If your proposal mirrors a recipe from the reference, state
  explicitly why the target's DOM permits that recipe.** The
  observation report's Matched regions and Cross-cutting observations
  sections name the structural asymmetries. Recipes that work on one
  structure can fail silently on a different structure. USE that
  information.
- Flag what the proposal doesn't close (if anything) and whether a
  follow-up is needed.

Present 2–3 options per significant gap when there's genuine choice
(CSS only vs component override vs layout replacement). Estimate
rough effort. Let the user pick.

### Step 4 — Implement

Only after the user has agreed on an approach. Make the edits.
Keep changes small and surgical — don't bundle unrelated cleanups.

### Step 5 — Verify by re-capture

After each structural change, re-run `visual-rosetta` in capture mode
against the implementation and the reference. Compare the new overlay
to the reference overlay:

- Does the gap close structurally (bboxes align, display primitive
  matches)?
- Did any new structural differences appear as a side effect?

**A gap that does not close structurally means the approach was wrong
— not that spacing needs more tuning.** If the second re-capture still
shows the same structural delta, back out and re-read the primitives
(step 2). Do not fall into a tweak-and-pray loop.

## Common anti-patterns to avoid

1. **Reading the report and skipping step 2.** This is the starlight-v1
   failure mode. The report said "`.page` wraps both header and body";
   the session proposed `max-width` on `.page` anyway. The asymmetry
   was acknowledged but not used.
2. **Proposing CSS before step 1 is complete.** If you don't know
   which gaps the user wants to close, you're proposing fixes for
   things that may not be targets.
3. **Classifying deltas as "structure-solvable" vs "style-solvable".**
   The observation report deliberately does not make this
   classification. That judgment lives in the remediation discussion
   and depends on user intent, not on tool output.
4. **Re-running scripts before the discussion.** The artifacts in the
   package are authoritative. Only re-capture after implementing a
   change, to verify it worked (step 5).
5. **Skipping the verification re-capture because the eye sees the
   fix working.** The tool caught asymmetries the eye missed during
   the original gap (that's why the tool exists). It'll catch them on
   re-capture too.

## Done criteria

- Every "target" question from step 1 has an agreed-upon approach and
  an implemented change
- Step 5 re-capture confirms gaps closed
- No unacknowledged structural drift introduced by the fixes
- Outstanding questions logged for a follow-up session if needed

Once done, suggest: *"ready to commit, or capture a fresh package to
archive the resolved state?"*
