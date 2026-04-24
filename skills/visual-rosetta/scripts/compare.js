#!/usr/bin/env node
// compare.js — Mechanical pair comparison for region maps.
//
// Reads two region-map JSONs (emitted by enumerate.sh) and writes a delta
// JSON containing matched pairs, unmatched regions, and cross-cutting
// observations. Observational only — does not prescribe remediations.
//
// Usage (via wrapper):
//   compare.sh <ref-map.json> <impl-map.json> [output-dir] [name-stem]
//
// Output path: <output-dir>/<name-stem>.delta.json
//   - Default output-dir: ./comparisons
//   - Default name-stem:  compare-<YYYYMMDD-HHMMSS>

import fs from 'node:fs';
import path from 'node:path';

// ---------- CLI ----------

function main(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    console.error('usage: compare.js <ref-map.json> <impl-map.json> [output-dir] [name-stem]');
    process.exit(2);
  }
  const [refPath, implPath, outDirArg, nameStemArg] = args;
  const outDir = outDirArg || './comparisons';
  const nameStem = nameStemArg || ('compare-' + timestamp());

  const refMap = readMap(refPath);
  const implMap = readMap(implPath);

  const delta = compareMaps(refMap, implMap, {
    refPath: path.resolve(refPath),
    implPath: path.resolve(implPath),
  });

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, nameStem + '.delta.json');
  fs.writeFileSync(outPath, JSON.stringify(delta, sortedKeys, 2) + '\n');
  console.log('delta: ' + outPath);
}

function readMap(p) {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// ---------- comparison orchestrator ----------

function compareMaps(refMap, implMap, ctx) {
  // For matching, flatten through single-child wrappers so the pool
  // contains only meaningful regions. Otherwise a wrapper like
  // `div.page.sl-flex` (parent of [header, sidebar, main-frame]) gets
  // paired with the reference's semantically-different `div.docs-body`
  // purely because they share tag+quadrant.
  const refFlat = flattenForMatching(refMap.candidates || []);
  const implFlat = flattenForMatching(implMap.candidates || []);

  const { matched, unmatchedRef, unmatchedImpl } = matchRegions(refFlat, implFlat);
  const observations = observe(refMap, implMap, refFlat, implFlat);

  return {
    generatedAt: new Date().toISOString(),
    reference: summarizeMap(refMap, ctx.refPath),
    implementation: summarizeMap(implMap, ctx.implPath),
    matchedPairs: matched,
    unmatched: {
      referenceOnly: unmatchedRef,
      implementationOnly: unmatchedImpl,
    },
    observations,
  };
}

function summarizeMap(m, p) {
  return {
    path: p,
    url: m.url,
    framework: m.framework || null,
    viewport: m.viewport,
    document: m.document,
    scope: m.scope,
    maxDepth: m.maxDepth,
  };
}

function flattenCandidates(list) {
  const out = [];
  const walk = (nodes) => {
    for (const c of nodes || []) {
      out.push(c);
      if (c.children && c.children.length) walk(c.children);
    }
  };
  walk(list);
  return out;
}

// Flatten applying `descendWrappers` at every subtree, not just the top.
// Single-child wrappers are skipped (the match pool sees their effective
// children directly); real regions at any depth are included.
function flattenForMatching(list) {
  const out = [];
  const walk = (nodes) => {
    const effective = effectiveTopLevel(nodes);
    for (const c of effective) {
      out.push(c);
      if (c.children && c.children.length) walk(c.children);
    }
  };
  walk(list);
  return out;
}

// ---------- matching (three-tier heuristic) ----------

function matchRegions(refList, implList) {
  const pool = implList.slice();
  const matched = [];
  const unmatchedRef = [];

  const tiers = [
    { fn: findByExactSelector, tier: 'high', basis: 'selector' },
    { fn: findByAriaLabel, tier: 'high', basis: 'role+aria-label' },
    { fn: findBySemanticTagSingleton, tier: 'moderate', basis: 'semantic-tag-singleton' },
    { fn: findByTagQuadrantAspect, tier: 'moderate', basis: 'tag+quadrant+aspect' },
    { fn: findByTagQuadrant, tier: 'low', basis: 'tag+quadrant' },
  ];

  for (const refCand of refList) {
    let hit = null;
    for (const t of tiers) {
      const found = t.fn(refCand, pool);
      if (found) {
        hit = { candidate: found, tier: t.tier, basis: t.basis };
        break;
      }
    }
    if (hit) {
      const idx = pool.indexOf(hit.candidate);
      if (idx >= 0) pool.splice(idx, 1);
      matched.push({
        confidence: hit.tier,
        basis: hit.basis,
        reference: projectCandidate(refCand),
        implementation: projectCandidate(hit.candidate),
        diffs: diffCandidates(refCand, hit.candidate),
      });
    } else {
      unmatchedRef.push(projectCandidate(refCand));
    }
  }

  return {
    matched,
    unmatchedRef,
    unmatchedImpl: pool.map(projectCandidate),
  };
}

function findByExactSelector(ref, pool) {
  if (!ref.selector) return null;
  return pool.find((c) => c.selector === ref.selector) || null;
}

function findByAriaLabel(ref, pool) {
  if (!ref.ariaLabel && !ref.role) return null;
  // Same aria-label is strongest. Next: same role + same tag.
  if (ref.ariaLabel) {
    const byAria = pool.find((c) => c.ariaLabel === ref.ariaLabel);
    if (byAria) return byAria;
  }
  if (ref.role) {
    const byRoleTag = pool.find((c) => c.role === ref.role && c.tagName === ref.tagName);
    if (byRoleTag) return byRoleTag;
  }
  return null;
}

// If the reference's semantic tag (header/footer/main/nav/aside) appears
// exactly once in the impl pool, pair them — a singleton semantic tag
// match carries moderate confidence even without matching position.
const SEMANTIC_TAGS = { header: 1, footer: 1, main: 1, nav: 1, aside: 1 };
function findBySemanticTagSingleton(ref, pool) {
  if (!SEMANTIC_TAGS[ref.tagName]) return null;
  const candidates = pool.filter((c) => c.tagName === ref.tagName);
  if (candidates.length !== 1) return null;
  return candidates[0];
}

function findByTagQuadrantAspect(ref, pool) {
  const refAsp = aspectRatio(ref.bbox);
  if (refAsp === null) return null;
  return (
    pool.find((c) => {
      if (c.tagName !== ref.tagName) return false;
      if (c.quadrant !== ref.quadrant) return false;
      const a = aspectRatio(c.bbox);
      if (a === null) return false;
      return Math.abs(a - refAsp) / refAsp <= 0.25;
    }) || null
  );
}

function findByTagQuadrant(ref, pool) {
  return (
    pool.find((c) => c.tagName === ref.tagName && c.quadrant === ref.quadrant) || null
  );
}

function aspectRatio(bbox) {
  if (!bbox || !bbox.h) return null;
  return bbox.w / bbox.h;
}

// ---------- per-pair diffs ----------

const DIFF_FIELDS = [
  'tagName',
  'role',
  'ariaLabel',
  'display',
  'flexDirection',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridTemplateAreas',
  'padding',
  'margin',
  'score',
];

function diffCandidates(ref, impl) {
  const diffs = [];
  for (const field of DIFF_FIELDS) {
    const r = normalizeValue(ref[field]);
    const i = normalizeValue(impl[field]);
    if (!valuesEqual(r, i)) diffs.push({ field, ref: r, impl: i });
  }
  for (const key of ['x', 'y', 'w', 'h']) {
    const r = ref.bbox && ref.bbox[key];
    const i = impl.bbox && impl.bbox[key];
    if (!valuesEqual(r, i)) diffs.push({ field: 'bbox.' + key, ref: r ?? null, impl: i ?? null });
  }
  return diffs;
}

function normalizeValue(v) {
  if (v === undefined) return null;
  return v;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  return false;
}

function projectCandidate(c) {
  return {
    selector: c.selector,
    tagName: c.tagName,
    role: c.role ?? null,
    ariaLabel: c.ariaLabel ?? null,
    bbox: c.bbox,
    quadrant: c.quadrant,
    depth: c.depth,
    display: c.display,
    gridTemplateColumns: c.gridTemplateColumns ?? null,
    gridTemplateRows: c.gridTemplateRows ?? null,
    gridTemplateAreas: c.gridTemplateAreas ?? null,
    flexDirection: c.flexDirection ?? null,
    padding: c.padding,
    margin: c.margin,
    score: c.score,
  };
}

// ---------- cross-cutting observations ----------

function observe(refMap, implMap, refFlat, implFlat) {
  const obs = [];
  const refTop = effectiveTopLevel(refMap.candidates || []);
  const implTop = effectiveTopLevel(implMap.candidates || []);

  // Effective-top count
  obs.push({
    category: 'top-level-count',
    side: 'both',
    description:
      'Reference effective top-level regions: ' +
      refTop.length +
      '. Implementation: ' +
      implTop.length +
      '.',
    reference: refTop.length,
    implementation: implTop.length,
  });

  // Bbox overlap at top-level
  const refOverlaps = findOverlaps(refTop);
  if (refOverlaps.length) {
    obs.push({
      category: 'bbox-overlap',
      side: 'reference',
      description:
        refOverlaps.length +
        ' pair(s) of top-level regions overlap: ' +
        refOverlaps
          .map((p) => p.a + ' ∩ ' + p.b + ' = ' + p.ratio.toFixed(2))
          .join('; '),
      pairs: refOverlaps,
    });
  }
  const implOverlaps = findOverlaps(implTop);
  if (implOverlaps.length) {
    obs.push({
      category: 'bbox-overlap',
      side: 'implementation',
      description:
        implOverlaps.length +
        ' pair(s) of top-level regions overlap: ' +
        implOverlaps
          .map((p) => p.a + ' ∩ ' + p.b + ' = ' + p.ratio.toFixed(2))
          .join('; '),
      pairs: implOverlaps,
    });
  }

  // Display primitive distribution on top-level
  const refDisplay = countBy(refTop, (c) => c.display);
  const implDisplay = countBy(implTop, (c) => c.display);
  obs.push({
    category: 'display-primitive-distribution',
    side: 'both',
    description:
      'Top-level display values — reference: ' +
      formatCounts(refDisplay) +
      '; implementation: ' +
      formatCounts(implDisplay),
    reference: refDisplay,
    implementation: implDisplay,
  });

  // Width sum at top-level vs viewport
  const refWSum = refTop.reduce((a, c) => a + ((c.bbox && c.bbox.w) || 0), 0);
  const implWSum = implTop.reduce((a, c) => a + ((c.bbox && c.bbox.w) || 0), 0);
  const refVp = (refMap.viewport && refMap.viewport.w) || 0;
  const implVp = (implMap.viewport && implMap.viewport.w) || 0;
  obs.push({
    category: 'top-level-width-sum',
    side: 'both',
    description:
      'Sum of top-level widths — reference: ' +
      refWSum +
      'px (viewport ' +
      refVp +
      '); implementation: ' +
      implWSum +
      'px (viewport ' +
      implVp +
      ').',
    reference: { widthSum: refWSum, viewport: refVp },
    implementation: { widthSum: implWSum, viewport: implVp },
  });

  // Scoped-class presence (selectors containing escaped colons or scoped hashes)
  const refScoped = refFlat.filter((c) => hasScopedClass(c.selector)).length;
  const implScoped = implFlat.filter((c) => hasScopedClass(c.selector)).length;
  obs.push({
    category: 'scoped-class-presence',
    side: 'both',
    description:
      'Candidates whose selectors contain scoped-hash or escaped-colon markers — reference: ' +
      refScoped +
      '/' +
      refFlat.length +
      '; implementation: ' +
      implScoped +
      '/' +
      implFlat.length +
      '.',
    reference: { scoped: refScoped, total: refFlat.length },
    implementation: { scoped: implScoped, total: implFlat.length },
  });

  // Framework difference
  const rf = (refMap.framework && refMap.framework.framework) || null;
  const imf = (implMap.framework && implMap.framework.framework) || null;
  if (rf !== imf) {
    obs.push({
      category: 'framework-difference',
      side: 'both',
      description:
        'Reference framework: ' +
        rf +
        ' (' +
        (refMap.framework?.confidence || '?') +
        '). Implementation framework: ' +
        imf +
        ' (' +
        (implMap.framework?.confidence || '?') +
        ').',
      reference: refMap.framework || null,
      implementation: implMap.framework || null,
    });
  }

  return obs;
}

function effectiveTopLevel(candidates) {
  if (!candidates) return [];
  if (
    candidates.length === 1 &&
    Array.isArray(candidates[0].children) &&
    candidates[0].children.length > 0
  ) {
    return effectiveTopLevel(candidates[0].children);
  }
  return candidates;
}

function findOverlaps(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const r = overlapRatio(list[i].bbox, list[j].bbox);
      if (r >= 0.1) out.push({ a: list[i].selector, b: list[j].selector, ratio: r });
    }
  }
  return out;
}

function overlapRatio(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? inter / smaller : 0;
}

function countBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => v + '×' + k)
    .join(', ');
}

function hasScopedClass(selector) {
  if (!selector) return false;
  return /\\:/.test(selector) || /astro-[a-z0-9]{5,}/.test(selector) || /css-[A-Za-z0-9]+/.test(selector);
}

// ---------- stable JSON output ----------

function sortedKeys(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = value[k];
        return acc;
      }, {});
  }
  return value;
}

main(process.argv);
