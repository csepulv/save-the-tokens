// enumerate.js — DOM region candidate enumeration for the visual-rosetta skill.
//
// Runs in the browser via `agent-browser eval`. Returns a JSON-serializable
// object describing ranked region candidates rooted at a given scope selector.
//
// Parameters are read from window.__ENUM_PARAMS (injected by the shell wrapper):
//   scope:       CSS selector for the subtree root (default 'body')
//   maxDepth:    how many levels deep to walk (default 3)
//   minAreaPct:  minimum fraction of viewport area for a layout-heuristic hit
//                (default 0.05 = 5%)
//
// Output shape:
//   {
//     url, viewport, document, scope, maxDepth,
//     candidates: [ { score, reasons, selector, bbox, tagName, role, ariaLabel,
//                     classes, depth, descendants, display, bgColor, children: [...] } ]
//   }
//
// Candidates are returned as a tree — a candidate's children array holds
// sub-candidates that rank as regions in their own right. Non-region elements
// are walked-through but not emitted; their region-scoring descendants are
// promoted to the nearest enclosing emitted candidate.

(function () {
  var params = (typeof window !== 'undefined' && window.__ENUM_PARAMS) || {};
  var SCOPE = params.scope || 'body';
  var MAX_DEPTH = typeof params.maxDepth === 'number' ? params.maxDepth : 3;
  var MIN_AREA_PCT = typeof params.minAreaPct === 'number' ? params.minAreaPct : 0.05;
  var EMIT_THRESHOLD = typeof params.emitThreshold === 'number' ? params.emitThreshold : 20;

  var LANDMARK_ROLES = {
    banner: 1, navigation: 1, main: 1, complementary: 1,
    contentinfo: 1, search: 1, form: 1, region: 1
  };
  var SEMANTIC_TAGS = {
    header: 1, nav: 1, main: 1, aside: 1, footer: 1, section: 1, article: 1
  };
  var LAYOUT_DISPLAYS = {
    grid: 1, flex: 1, 'inline-grid': 1, 'inline-flex': 1
  };

  var vpW = window.innerWidth;
  var vpH = window.innerHeight;
  var docW = document.documentElement.scrollWidth;
  var docH = document.documentElement.scrollHeight;
  var viewportArea = vpW * vpH;

  var root = document.querySelector(SCOPE);
  if (!root) {
    return { error: 'scope selector not found: ' + SCOPE };
  }

  // ---------- helpers ----------

  function stripScopedClass(c) {
    // Astro scoped: astro-vrdttmbt
    if (/^astro-[a-z0-9]{6,}$/.test(c)) return '';
    // Remove CSS-Modules-style hash suffix: Foo_bar__hash -> Foo_bar
    return c.replace(/__[A-Za-z0-9_-]{4,}$/, '');
  }

  function normalizeClassName(cls) {
    if (!cls || typeof cls !== 'string') return '';
    return cls.split(/\s+/).map(stripScopedClass).filter(Boolean).join(' ');
  }

  function generateSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;

    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role');
    var ariaLabel = el.getAttribute('aria-label');

    if (role && LANDMARK_ROLES[role]) {
      return tag + '[role="' + role + '"]';
    }
    if (ariaLabel) {
      // Escape quotes minimally
      var safe = ariaLabel.replace(/"/g, '\\"');
      return tag + '[aria-label="' + safe + '"]';
    }

    var normClasses = normalizeClassName(el.className);
    if (normClasses) {
      // CSS.escape handles colons (Tailwind `lg:flex`), brackets, dots, etc.
      var escaped = normClasses.split(/\s+/).map(function (c) { return CSS.escape(c); });
      return tag + '.' + escaped.join('.');
    }

    // Structural fallback: nth-child from nearest stable ancestor
    var parent = el.parentElement;
    if (parent) {
      var index = Array.prototype.indexOf.call(parent.children, el) + 1;
      return generateSelector(parent) + ' > ' + tag + ':nth-child(' + index + ')';
    }
    return tag;
  }

  function quadrant(bbox) {
    var cx = bbox.x + bbox.w / 2;
    var cy = bbox.y + bbox.h / 2;
    var h = cx < vpW / 3 ? 'left' : cx > (2 * vpW) / 3 ? 'right' : 'center';
    var v = cy < vpH / 3 ? 'top' : cy > (2 * vpH) / 3 ? 'bottom' : 'middle';
    return v + '-' + h;
  }

  function scoreCandidate(el, bbox, parentBbox, depth) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role');
    var ariaLabel = el.getAttribute('aria-label');
    var cs = getComputedStyle(el);

    var score = 0;
    var reasons = [];

    // --- strongest signals: ARIA landmarks ---
    if (role && LANDMARK_ROLES[role]) {
      score += 100;
      reasons.push('landmark:' + role);
    }
    if (ariaLabel) {
      score += 30;
      reasons.push('aria-label');
    }

    // --- semantic HTML5 ---
    if (SEMANTIC_TAGS[tag]) {
      score += 50;
      reasons.push('semantic:' + tag);
    }

    // --- layout heuristics ---
    var area = bbox.w * bbox.h;
    var areaOfVp = area / viewportArea;
    var widthOfParent = parentBbox.w > 0 ? bbox.w / parentBbox.w : 0;
    var heightOfParent = parentBbox.h > 0 ? bbox.h / parentBbox.h : 0;

    if (areaOfVp >= MIN_AREA_PCT) {
      score += Math.min(30, areaOfVp * 50);
      reasons.push('area:' + (areaOfVp * 100).toFixed(1) + '%vp');
    }
    if (widthOfParent >= 0.8 || heightOfParent >= 0.8) {
      score += 15;
      reasons.push('spans-parent');
    }

    // --- content-rich ---
    var descendants = el.querySelectorAll('*').length;
    if (descendants >= 5) {
      score += Math.min(10, Math.round(Math.log(descendants) * 2));
      reasons.push('descendants:' + descendants);
    }

    // --- visual differentiation ---
    var bg = cs.backgroundColor;
    var parentBg = el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : '';
    var hasDistinctBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== parentBg;
    if (hasDistinctBg) {
      score += 10;
      reasons.push('distinct-bg');
    }
    var borderWidth = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) +
                      parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    if (borderWidth > 0) {
      score += 5;
      reasons.push('bordered');
    }

    // --- layout container ---
    var display = cs.display;
    if (LAYOUT_DISPLAYS[display] && el.children.length >= 2) {
      score += 5;
      reasons.push('layout:' + display);
    }

    // --- shallow depth bonus ---
    if (depth <= 2) {
      score += 10;
      reasons.push('shallow');
    }

    var gtc = cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : undefined;
    var gtr = cs.gridTemplateRows !== 'none' ? cs.gridTemplateRows : undefined;
    var gta = cs.gridTemplateAreas !== 'none' ? cs.gridTemplateAreas : undefined;

    return {
      score: Math.round(score),
      reasons: reasons,
      selector: generateSelector(el),
      tagName: tag,
      role: role,
      ariaLabel: ariaLabel,
      classes: normalizeClassName(el.className),
      bbox: bbox,
      quadrant: quadrant(bbox),
      depth: depth,
      descendants: descendants,
      display: display,
      bgColor: bg,
      widthOfParent: +widthOfParent.toFixed(3),
      heightOfParent: +heightOfParent.toFixed(3),
      areaOfViewport: +areaOfVp.toFixed(4),
      gridTemplateColumns: gtc,
      gridTemplateRows: gtr,
      gridTemplateAreas: gta,
      flexDirection: display.indexOf('flex') >= 0 ? cs.flexDirection : undefined,
      padding: cs.padding,
      margin: cs.margin,
      children: []
    };
  }

  function getBbox(el) {
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  }

  // Inspect the document for markers of known frameworks. Emits one label
  // (Starlight / Astro / React+Chakra / plain), a confidence tier, and the
  // evidence the call was based on. Plain means "we looked for known
  // markers and found none" — useful signal, not absence of information.
  // See `references/fingerprint.md` for the rule set.
  function detectFramework() {
    var evidence = [];

    if (document.getElementById('starlight__sidebar')) {
      evidence.push('id:starlight__sidebar');
    }
    if (document.querySelector('starlight-menu-button')) {
      evidence.push('custom-element:starlight-menu-button');
    }
    if (document.querySelector('astro-island')) {
      evidence.push('custom-element:astro-island');
    }

    var assetEls = document.querySelectorAll('link[rel="stylesheet"][href], script[src]');
    var hasAstroAsset = false;
    for (var a = 0; a < assetEls.length; a++) {
      var href = assetEls[a].href || assetEls[a].src || '';
      if (href.indexOf('/_astro/') >= 0) { hasAstroAsset = true; break; }
    }
    if (hasAstroAsset) evidence.push('asset-path:/_astro/');

    var counts = { sl: 0, astroHash: 0, emotion: 0, chakra: 0 };
    var classed = document.querySelectorAll('[class]');
    var limit = Math.min(classed.length, 800);
    for (var i = 0; i < limit; i++) {
      var cls = classed[i].className;
      if (typeof cls !== 'string') continue;
      var tokens = cls.split(/\s+/);
      for (var j = 0; j < tokens.length; j++) {
        var t = tokens[j];
        if (!t) continue;
        if (/^sl-/.test(t)) counts.sl++;
        else if (/^astro-[a-z0-9]{5,}$/.test(t)) counts.astroHash++;
        else if (/^css-[A-Za-z0-9]+$/.test(t)) counts.emotion++;
        else if (/^chakra-/.test(t)) counts.chakra++;
      }
    }
    if (counts.sl > 0) evidence.push('class-prefix:sl-* (count:' + counts.sl + ')');
    if (counts.astroHash > 0) evidence.push('class-pattern:astro-<hash> (count:' + counts.astroHash + ')');
    if (counts.emotion > 0) evidence.push('class-pattern:css-<hash> (count:' + counts.emotion + ')');
    if (counts.chakra > 0) evidence.push('class-prefix:chakra-* (count:' + counts.chakra + ')');

    // Marker-count buckets for classification. Starlight is a superset of
    // Astro for the purposes of markers — its pages carry astro-<hash>
    // classes too. Order matters: Starlight wins when its markers are
    // present, then Astro, then Chakra, then plain.
    var slMarkers = 0;
    var astroMarkers = 0;
    var chakraMarkers = 0;
    for (var k = 0; k < evidence.length; k++) {
      var e = evidence[k];
      if (e.indexOf('starlight') >= 0 || e.indexOf('sl-*') >= 0) slMarkers++;
      if (e.indexOf('astro') >= 0) astroMarkers++;
      if (e.indexOf('chakra') >= 0 || e.indexOf('css-<hash>') >= 0) chakraMarkers++;
    }

    var framework = 'plain';
    var confidence = 'high';
    if (slMarkers >= 2) { framework = 'Starlight'; confidence = 'high'; }
    else if (slMarkers === 1) { framework = 'Starlight'; confidence = 'moderate'; }
    else if (astroMarkers >= 2) { framework = 'Astro'; confidence = 'high'; }
    else if (astroMarkers === 1) { framework = 'Astro'; confidence = 'moderate'; }
    else if (chakraMarkers >= 2) { framework = 'React+Chakra'; confidence = 'high'; }
    else if (chakraMarkers === 1) { framework = 'React+Chakra'; confidence = 'moderate'; }

    return { framework: framework, confidence: confidence, evidence: evidence };
  }

  // Walk the tree. Emit candidates that meet EMIT_THRESHOLD; promote
  // region-scoring descendants of non-emitted elements to the enclosing
  // emitted parent.
  function walk(el, depth, parentBbox) {
    var out = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      var cs = getComputedStyle(child);
      // Hard skip: truly not rendered.
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      var bbox = getBbox(child);
      var childNext = depth + 1;

      // Zero-bbox wrapper (e.g. Starlight's `nav.sidebar` with h=0 containing a
      // visible `div.sidebar-pane`). Don't score, but walk through so visible
      // descendants aren't lost.
      if (bbox.w < 10 || bbox.h < 10) {
        if (childNext <= MAX_DEPTH) {
          var promotedZ = walk(child, childNext, parentBbox);
          for (var k = 0; k < promotedZ.length; k++) out.push(promotedZ[k]);
        }
        continue;
      }

      var cand = scoreCandidate(child, bbox, parentBbox, depth);

      if (cand.score >= EMIT_THRESHOLD) {
        if (childNext <= MAX_DEPTH) {
          cand.children = walk(child, childNext, bbox);
        }
        out.push(cand);
      } else if (childNext <= MAX_DEPTH) {
        // Promote: pretend this level doesn't exist
        var promoted = walk(child, childNext, parentBbox);
        for (var j = 0; j < promoted.length; j++) out.push(promoted[j]);
      }
    }
    return out;
  }

  // ---------- run ----------

  var rootBbox = getBbox(root);
  var candidates = walk(root, 1, rootBbox);

  return {
    url: location.href,
    capturedAt: new Date().toISOString(),
    viewport: { w: vpW, h: vpH },
    document: { w: docW, h: docH },
    scope: SCOPE,
    scopeBbox: rootBbox,
    maxDepth: MAX_DEPTH,
    emitThreshold: EMIT_THRESHOLD,
    framework: detectFramework(),
    candidates: candidates
  };
})();
