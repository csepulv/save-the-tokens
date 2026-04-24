# Authoring an observation report

Guidance for the agent that writes the markdown report from a
`compare.sh` delta JSON. Read this before writing.

This doc is loaded during **capture mode**, after `compare.sh` produces
the delta JSON for a pair. The report is one of the capture-mode
deliverables; prepare mode later packages it into the handoff bundle.
The remediation workflow that consumes the report lives in
`references/review.md`.

## The one principle

**Report facts and questions. Do not report judgments.**

The report's reader is a remediation session that hasn't happened yet. That
session's job is to decide what matters, what's a target, and what's
acceptable variance — given the user's goals, the target stack's
affordances, and constraints you don't have visibility into. If you write
"the implementation should use grid here," you've made that session's
decision for it, probably wrong.

If you want to say "should," rewrite it as a question: "is grid a target
for this region?"

## Required sections

Every report contains these sections in this order:

1. **Context** — one paragraph. What reference and implementation are
   being compared, what frameworks each side runs on (from the fingerprint
   fields in the delta), relevant metadata like viewport and document
   size. No judgments.

2. **Matched regions** — the pairs the mechanical matcher produced, with
   their attribute differences. Group by confidence tier (high / moderate
   / low). For each pair:
   - State the ref↔impl selector pairing and the matcher basis
     (`selector` / `role+aria-label` / `semantic-tag-singleton` /
     `tag+quadrant+aspect` / `tag+quadrant`)
   - List the attribute diffs (display, gridTemplateColumns, bbox, etc.)
     as observations
   - For low-confidence pairs, note that the match is heuristic and may
     not reflect semantic equivalence. Do not propose corrections.

3. **Unmatched regions** — regions present on one side only.
   - Reference-only: list selectors, bbox, and key attributes.
   - Implementation-only: same.
   - Note obvious candidate re-pairings where the mechanical matcher
     missed (e.g. ref `<nav aria-label="Docs sidebar">` vs impl
     `<div id="starlight__sidebar">` — different tags, similar purpose).
     Frame as observation ("both sides have a left-column navigation
     region that the mechanical matcher did not pair"), not prescription.

4. **Cross-cutting observations** — entries from the delta JSON's
   `observations` array, expanded with context. Each observation is
   already a fact; your job is to make it readable:
   - `top-level-count`, `bbox-overlap`, `display-primitive-distribution`,
     `top-level-width-sum`, `scoped-class-presence`, `framework-difference`
   - When an observation suggests a structural hypothesis (e.g. bbox
     overlap + block display + padding-based positioning), you may state
     the hypothesis — *as a hypothesis*. Frame as "suggests" / "may
     indicate," not "is because of."

5. **Open questions** — questions surfaced by the facts. These go to the
   remediation session. Examples of what belongs here:
   - Questions of intent: *"Reference has a footer region. Is the
     implementation intended to have a separate footer region, or is
     in-content prev/next placement acceptable?"*
   - Questions of fidelity: *"Reference's body region width sums to
     1187px (within a 1264px max-width centered container).
     Implementation's body widths sum to the viewport width (1280px).
     Is constrained centered layout a target?"*
   - Questions of granularity: *"Reference sub-region widths are
     240/727/220px. Implementation is 240/715/325px (m1) or 260/695/325px
     (m2). Are exact dimensions targets, or is the proportional layout
     sufficient?"*
   - Questions raised by unmatched regions or low-confidence pairs.

6. **Artifacts** — paths to the underlying maps and overlay PNGs so the
   remediation session can drill in.

## Tone — observational vs prescriptive

### Facts (OK)

- "Reference's top-level region 2 uses `display: grid` with
  `grid-template-columns: 240px 1fr 220px`. Implementation's
  corresponding region uses `display: block` with
  `padding: 72px 0 0 260px`."
- "Implementation's third top-level region has a bbox that covers the
  entire viewport, overlapping regions 1 and 2 at 100%."
- "The reference has three top-level regions (header, body, footer).
  The implementation has three top-level regions (header, sidebar,
  main-frame)."

### Hypotheses — OK when labeled

- "The 100% bbox overlap on the implementation side, combined with
  `display: block` on region 3 and substantial `padding` values,
  **suggests** a padding-based layout where the header and sidebar are
  positioned (fixed or absolute) rather than in flow as grid siblings."
- "The matcher paired these low-confidence based on tag and quadrant
  alone. These **may not be** semantically equivalent regions."

### Questions — OK

- "Is a grid-based body layout a target for the implementation, or is
  the current padding-based approach acceptable if visual symptoms are
  addressed differently?"
- "The reference has `<nav aria-label='Docs sidebar'>`; the
  implementation has `<div id='starlight__sidebar'>`. Same purpose,
  different markup. Is the semantic `<nav>` a target?"

### Prescriptions (not OK — "forbidden terms")

These words, applied to the comparison facts, signal prescription:

- **should / must / target / fix / solve / remediate / correct**
- "needs to be" / "needs to become" / "has to"
- "priority" / "high-priority" / "P1" / "P2"
- "structural-solvable" / "style-solvable" (that classification is the
  remediation session's job)
- "change X to Y" / "replace X with Y" / "update X"

Example rewrites:

| Prescriptive                                      | Observational                                          |
|---------------------------------------------------|--------------------------------------------------------|
| "Change `main-frame` to `display: grid`."         | "Reference body is `display: grid`; implementation body is `display: block`. Is grid a target?" |
| "The footer should be a sibling region."          | "Reference has footer as a top-level sibling; implementation does not. Is a separate footer region a target?" |
| "Fix the bbox overlap."                           | "Implementation's third region overlaps regions 1 and 2 at 100%." |
| "This is a high-priority structural gap."         | *(nothing — priority is not the report's call)*        |

## Common slippage to watch for

1. **"The tool found X; you should fix it."** You're speaking to a
   session that will read the facts and decide. Skip "you should."

2. **Ordering = priority.** If you put the biggest structural finding
   first, you're implicitly prioritizing. Order sections consistently
   (always matched, then unmatched, then observations, then questions)
   so the reader's mental model doesn't confuse "first" with "most
   important."

3. **Sub-section sort.** Within matched regions, sort by confidence tier
   (high → moderate → low), then by reference selector. Mechanical
   ordering, not judgment.

4. **Leading observations with hedging.** "While it may be the case
   that…" — if you're hedging, you're editorializing. State the fact or
   the question, not a softened opinion.

5. **"This is clearly the reference's intent."** You don't know the
   reference's intent. Observe *that* the reference does X. Do not
   attribute intent unless it's from the user's brief.

6. **Templated questions that read wooden.** The tool's observations
   are the raw material; you shape them into questions the user would
   reasonably want to discuss. A literal "Is [value] the target?"
   repeated 15 times is lazy. Pick the questions that actually matter.

## Quick checklist before you ship the report

- [ ] Every required section present
- [ ] No forbidden terms (`should`, `must`, `target` (as verb), `fix`,
      `solve`, `remediate`, priority labels) applied to deltas
- [ ] Hypotheses framed with "suggests" / "may indicate"
- [ ] Open questions are genuine questions, not thinly-disguised
      directives
- [ ] Artifacts section has paths to both region maps, both overlay
      PNGs, and the delta JSON this report was authored from

If the keyword preflight (see B.1 in the scenarios doc) turns up a hit,
read the sentence. If it's truly observational, keep it and move on —
false positives are expected. If it's prescriptive, rewrite.

