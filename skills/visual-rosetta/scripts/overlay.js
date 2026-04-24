// overlay.js — draw the region map onto the live page as outline rectangles.
//
// Runs in the browser via `agent-browser eval` AFTER enumerate.js has produced
// its candidate tree. The wrapper prepends `window.__RMO_MAP = <JSON>;` so
// this script can read it directly.
//
// Color scheme, matching the design-system boxes in the reference workflow:
//   red    — top-level candidates (the macro structure)
//   purple — their direct children (sub-regions within each macro block)
// Deeper levels are not drawn; two tiers keeps the overlay readable and forces
// the top-down structural diagnostic to come first.
//
// Output: injects a single absolute-positioned container into <body>, then
// returns a summary string. The caller takes a screenshot with the overlay
// in place; the next navigation or `close` cleans up the DOM anyway.

(function () {
  var OVERLAY_ID = '__rmo_overlay';
  var COLOR_OUTER = '#e03131'; // red
  var COLOR_INNER = '#7c4fcc'; // purple
  var FILL_OUTER = 'rgba(224, 49, 49, 0.06)';  // subtle red fill — overlaps darken
  var FILL_INNER = 'rgba(124, 79, 204, 0.04)'; // subtle purple fill
  var WIDTH_OUTER = 6;
  var WIDTH_INNER = 3;

  // Clean up any overlay from a prior run in the same session.
  var existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  var map = (typeof window !== 'undefined' && window.__RMO_MAP) || null;
  if (!map || !Array.isArray(map.candidates)) {
    return 'overlay: no candidates in window.__RMO_MAP';
  }

  var container = document.createElement('div');
  container.id = OVERLAY_ID;
  container.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'pointer-events:none',
    'z-index:2147483647'
  ].join(';');

  function drawRect(bbox, color, fill, borderWidth, label) {
    if (!bbox || bbox.w < 2 || bbox.h < 2) return;
    var rect = document.createElement('div');
    rect.style.cssText = [
      'position:absolute',
      'left:' + bbox.x + 'px',
      'top:' + bbox.y + 'px',
      'width:' + bbox.w + 'px',
      'height:' + bbox.h + 'px',
      'border:' + borderWidth + 'px solid ' + color,
      'background:' + fill,
      'box-sizing:border-box',
      'pointer-events:none'
    ].join(';');
    if (label) {
      var tag = document.createElement('div');
      tag.textContent = label;
      tag.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'padding:2px 6px',
        'background:' + color,
        'color:white',
        'font:600 11px/1.2 ui-monospace,Menlo,monospace',
        'white-space:nowrap',
        'pointer-events:none'
      ].join(';');
      rect.appendChild(tag);
    }
    container.appendChild(rect);
  }

  // Descend through single-child wrappers to find the level where sibling
  // regions actually diverge. Applied to both tiers:
  //   - Top level: `body > div.page.sl-flex > [header, sidebar, main-frame]`
  //     collapses to `[header, sidebar, main-frame]` — the macro structure.
  //   - Each top's children: `main-frame > [lg:sl-flex] > [main-pane, aside]`
  //     collapses to `[main-pane, aside]` — exposes the TOC as a purple.
  // Stops at the first level with ≥2 candidates (real siblings) OR a leaf.
  function descendWrappers(cands) {
    if (cands.length === 1 && Array.isArray(cands[0].children) && cands[0].children.length > 0) {
      return descendWrappers(cands[0].children);
    }
    return cands;
  }

  var topLevel = descendWrappers(map.candidates);

  var outerCount = 0;
  var innerCount = 0;
  topLevel.forEach(function (top) {
    drawRect(top.bbox, COLOR_OUTER, FILL_OUTER, WIDTH_OUTER, top.selector);
    outerCount++;
    var effectiveChildren = descendWrappers(top.children || []);
    effectiveChildren.forEach(function (child) {
      drawRect(child.bbox, COLOR_INNER, FILL_INNER, WIDTH_INNER, child.selector);
      innerCount++;
    });
  });

  document.body.appendChild(container);
  return 'overlay: ' + outerCount + ' outer + ' + innerCount + ' inner';
})();
