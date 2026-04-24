# Framework fingerprint rules

`enumerate.js` emits a `framework` field alongside the candidate tree:

```json
{
  "framework": {
    "framework": "Starlight",
    "confidence": "high",
    "evidence": [
      "id:starlight__sidebar",
      "custom-element:starlight-menu-button",
      "asset-path:/_astro/",
      "class-prefix:sl-* (count:42)"
    ]
  }
}
```

The intent is to give a downstream session enough signal to know *which
customization surface* it's working with — Starlight's component overrides
vs Astro's layout slots vs a React+Chakra theme vs nothing. The fingerprint
does not prescribe what to do with that knowledge; it's raw inference.

## Rule set (m1)

### Starlight

Markers:
- `id:starlight__sidebar` — Starlight renders the left sidebar with this id
- `custom-element:starlight-menu-button` — Starlight's mobile menu toggle
- `asset-path:/_astro/` — Astro-bundled assets (shared with non-Starlight Astro)
- `class-prefix:sl-*` — Starlight's component class convention (count >0)

Two or more markers → `confidence: "high"`. One marker → `"moderate"`.

### Astro (non-Starlight)

Markers:
- `custom-element:astro-island` — Astro's hydration boundary
- `class-pattern:astro-<hash>` — Astro's scoped-class naming (count >0)
- `asset-path:/_astro/`

Only classified as Astro when no Starlight markers are present. Starlight
wins, because its pages carry astro-<hash> classes too.

### React + Chakra

Markers:
- `class-pattern:css-<hash>` — emotion-generated class (Chakra's styling engine)
- `class-prefix:chakra-*` — Chakra's component class convention

Two or more markers → `"high"`. One marker → `"moderate"`.

### Plain

No markers. `confidence: "high"` because we looked and found none — the
high-confidence absence is useful signal, not missing information.

## Scan scope

- Ids, custom elements, and assets: single-query pass, cheap.
- Class-name patterns: sampled across up to 800 elements with `[class]`.
  Cap prevents pathological cost on very large DOMs; 800 has been
  sufficient for typical reference pages.

If a large page genuinely needs more coverage, raise the cap in
`detectFramework()`. The cap is an `implementation-detail` tuning knob, not
a contract.

## What's NOT covered yet

Future stacks (m2 candidates if fixtures appear):
- MUI — `css-<hash>` + MUI-specific data attributes
- Tailwind — utility-class density heuristic (many single-purpose tokens,
  few custom component classes)
- Bootstrap — `container`, `row`, `col-*`, `btn`

Extending is additive: add detection, extend `evidence` vocabulary, update
the classification cascade. No change to the emitted JSON shape.

## Reading the output

- `framework` — string label (one of Plain / Starlight / Astro /
  `React+Chakra` as of m1).
- `confidence` — high / moderate / low. "Plain" is always high-confidence
  (there's no partial plainness).
- `evidence` — list of strings, each a named marker that fired. Empty for
  plain. Use for debugging misfires or for drill-in when the label looks
  wrong.
