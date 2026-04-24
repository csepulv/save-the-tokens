# Region scoring heuristics

Detail on how `enumerate.js` scores region candidates, and when to tune.

## Scoring weights

Each DOM element in the walked subtree gets a score. Elements scoring above
`emitThreshold` (default 20) are emitted as candidates. Components:

| Signal | Weight | Condition |
|---|---|---|
| ARIA landmark role | +100 | `role` ∈ {banner, navigation, main, complementary, contentinfo, search, form, region} |
| `aria-label` present | +30 | Element has an `aria-label` attribute |
| Semantic HTML5 tag | +50 | `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<section>`, `<article>` |
| Viewport coverage | up to +30 | Capped at 30; proportional to `area / (vw*vh)` |
| Spans parent | +15 | Width ≥ 80% of parent's, or height ≥ 80% |
| Descendant count | up to +10 | `min(10, round(log(n) * 2))` where n ≥ 5 |
| Distinct background | +10 | Non-transparent `background-color`, different from parent's |
| Visible border | +5 | Sum of border widths > 0 |
| Layout container | +5 | `display: grid` or `display: flex` with ≥ 2 children |
| Shallow depth | +10 | Depth from scope ≤ 2 |

The weights are intentionally additive rather than multiplicative — this makes
scores easy to inspect (the `reasons` array tells you exactly which signals
fired).

## When to tune

**Too many candidates emitted?** Raise `emitThreshold`. Typical pages without
ARIA will produce noise around score 20–40; landmarks and semantic tags push
real regions well above 50.

**A known region isn't being emitted?** Check the `reasons` array on the
nearest emitted ancestor. Common causes:
- Element is inside a wrapper that didn't get promoted-through (walk hit
  `maxDepth`)
- Normalized class name is empty after scoped-hash stripping, and the element
  has no other signal
- Element is offscreen at capture time (scripts that lazy-render may need
  `wait --load networkidle` or manual scroll)

**Zero-bbox wrappers are walked through, not emitted.** Some frameworks (e.g.
Starlight's `nav.sidebar`) render a parent with `height: 0` whose children
have real bboxes. The walk descends into these without scoring them, so the
visible descendants still surface as candidates. `display:none` and
`visibility:hidden` are still hard-skipped.

**Scores feel miscalibrated for a particular site?** Edit the weights in
`scoreCandidate`. The weights above are tuned for content-heavy documentation
sites; app-like UIs with lots of grid-of-cards may need stronger weight on
`distinct-bg` or weaker weight on `descendants`.

## What scores mean in practice

Rough bands from the current weights (very site-dependent):

- **≥ 100**: near-certain region (landmark + semantic + layout)
- **60–100**: high-confidence region (semantic tag + size or landmark alone)
- **30–60**: probable region (size + layout, or semantic tag on a small element)
- **20–30**: threshold candidates; some are real, some are noise
- **< 20**: not emitted

## Class-name normalization

The script strips framework-generated scoped hashes before producing selectors
and normalized class names. Recognized patterns:

- Astro: `astro-vrdttmbt`, `astro-67yu43on` → removed
- CSS Modules: `Containers_fixedPosition__txNh6` → `Containers_fixedPosition`

Without this, every build regenerates different hashes and every region map
looks different. If you see raw scoped classes sneaking through the output,
add a regex to `stripScopedClass` in `enumerate.js`.

## The grid-vs-flex diagnostic

Every candidate includes `display`, `gridTemplateColumns`, `gridTemplateRows`,
`gridTemplateAreas`, and `flexDirection` when applicable. This is specifically
for catching structural mismatches like the Michi case:

- **Reference** `div.docs-body` → `display: grid`, `gridTemplateColumns: "240px 940px 220px"`
- **Implementation** `div.main-frame` → `display: flex` (nested flex, no template)

When Session B (the diff/resolution session) compares two region maps, a
difference in `display` on a region's **parent** (via the `children` tree
structure) is almost always the root cause of downstream layout gaps — and is
explicitly not fixable by CSS tweaks on the region itself.
