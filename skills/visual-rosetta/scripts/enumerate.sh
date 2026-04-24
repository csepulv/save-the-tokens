#!/usr/bin/env bash
# enumerate.sh — run region enumeration on a rendered page via agent-browser.
#
# Usage:
#   ./enumerate.sh <url-or-file> [scope-selector] [max-depth] [output-dir]
#
# Examples:
#   ./enumerate.sh file:///tmp/ref.html                 # top-level regions of body
#   ./enumerate.sh http://localhost:4321                # live dev server
#   ./enumerate.sh http://localhost:4321 'nav.sidebar'  # drill into sidebar
#   ./enumerate.sh file:///tmp/ref.html body 5 ./out    # deeper walk, custom outdir
#
# Produces in <output-dir>:
#   <slug>-<timestamp>.json  — region-candidate tree
#   <slug>-<timestamp>.png   — full-page screenshot
#   <slug>-<timestamp>.txt   — annotated screenshot sidecar (numbered elements)

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <url-or-file> [scope-selector] [max-depth] [output-dir]" >&2
  exit 2
fi

URL="$1"
SCOPE="${2:-body}"
# Default 4 — deep enough to reach granchildren-of-wrapper regions like
# Starlight's TOC (`main-frame > lg:sl-flex > aside.right-sidebar-container`).
# Simpler semantic pages aren't meaningfully noisier at 4 than at 3.
MAX_DEPTH="${3:-4}"
OUT_DIR="${4:-./region-maps}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENUM_JS="${SCRIPT_DIR}/enumerate.js"

if [[ ! -f "$ENUM_JS" ]]; then
  echo "enumerate.js not found next to this script: $ENUM_JS" >&2
  exit 1
fi

command -v agent-browser >/dev/null 2>&1 || {
  echo "agent-browser not on PATH. Install with: npm install -g agent-browser" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq not on PATH. Install with: brew install jq  (or apt/yum equivalent)" >&2
  exit 1
}

mkdir -p "$OUT_DIR"

# ---- normalize URL + decide on --allow-file-access ------------------------
AB_GLOBAL_ARGS=()
if [[ "$URL" == /* ]]; then
  URL="file://$URL"
fi
if [[ "$URL" == file://* ]]; then
  AB_GLOBAL_ARGS+=(--allow-file-access)
fi

# ---- build an output slug from the URL ------------------------------------
slug="$(echo "$URL" | sed 's|[^a-zA-Z0-9]|-|g' | tr -s '-' | sed 's/^-//;s/-$//' | cut -c1-60)"
timestamp="$(date +%Y%m%d-%H%M%S)"
base="${OUT_DIR}/${slug}-${timestamp}"

out_json="${base}.json"
out_png="${base}.png"
out_txt="${base}.txt"

# ---- close any stale daemon ----------------------------------------------
# Without this, a daemon already running from a prior invocation will ignore
# new global flags like --allow-file-access and silently produce partial output
# (eval succeeds but screenshot fails). Closing forces a clean restart.
agent-browser close >/dev/null 2>&1 || true

# ---- open + wait for idle -------------------------------------------------
agent-browser "${AB_GLOBAL_ARGS[@]}" open "$URL" >/dev/null
agent-browser wait --load networkidle >/dev/null || true

# ---- scroll to page top --------------------------------------------------
# URLs with hash fragments (#section) auto-scroll on load. Sticky/fixed
# headers then get measured with a non-zero scroll offset
# (`getBoundingClientRect + scrollY`), putting their bbox in the middle of
# the page. The full-page screenshot captures the scrolled state too, so
# overlay outlines and rendered elements match each other but neither
# reflect the page "at rest." Force-scrolling to (0, 0) ensures both the
# enumeration and the screenshot see the page in its natural top-of-doc
# state, regardless of any fragment on the URL.
agent-browser eval 'window.scrollTo(0, 0)' >/dev/null || true

# ---- run the enumeration script via eval --stdin --------------------------
# Parameters are injected by prepending a window.__ENUM_PARAMS assignment to
# the script source, then piping to `eval --stdin`.
{
  printf 'window.__ENUM_PARAMS = { scope: %s, maxDepth: %s };\n' \
    "$(printf '%s' "$SCOPE" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')" \
    "$MAX_DEPTH"
  cat "$ENUM_JS"
} | agent-browser eval --stdin --json > "${out_json}.raw"

# agent-browser --json wraps the result in { success, data: { result: ... } }.
# Pull out the useful payload. Fall back to raw if the shape isn't what we expect.
if jq -e '.data.result' "${out_json}.raw" >/dev/null 2>&1; then
  jq '.data.result' "${out_json}.raw" > "$out_json"
elif jq -e '.result' "${out_json}.raw" >/dev/null 2>&1; then
  jq '.result' "${out_json}.raw" > "$out_json"
else
  cp "${out_json}.raw" "$out_json"
fi
rm -f "${out_json}.raw"

# ---- verify enumeration output --------------------------------------------
# agent-browser returns exit 0 even when internal errors occur, so check the
# output looks like a region map before proceeding.
if ! jq -e '.candidates' "$out_json" >/dev/null 2>&1; then
  echo "error: enumeration output missing .candidates — see $out_json" >&2
  exit 1
fi

# ---- screenshot + annotated sidecar ---------------------------------------
agent-browser screenshot --full "$out_png" >/dev/null
if [[ ! -f "$out_png" ]]; then
  echo "error: screenshot was not produced at $out_png" >&2
  exit 1
fi
agent-browser screenshot --annotate "${base}-annotated.png" > "$out_txt" 2>&1 || true

# ---- region-overlay screenshot -------------------------------------------
# Inject outline rectangles onto the live page using the candidates we just
# emitted, then screenshot with them in place. This PNG is the Session A
# deliverable that couples visual to DOM: a downstream session can diff the
# overlay of a reference against an implementation and see structural
# mismatches (wrong sibling topology, wrong parent layout primitive, extra
# wrappers) without reaching for CSS.
OVERLAY_JS="${SCRIPT_DIR}/overlay.js"
out_overlay_png="${base}-overlay.png"
if [[ -f "$OVERLAY_JS" ]]; then
  {
    printf 'window.__RMO_MAP = '
    cat "$out_json"
    printf ';\n'
    cat "$OVERLAY_JS"
  } | agent-browser eval --stdin --json >/dev/null
  agent-browser screenshot --full "$out_overlay_png" >/dev/null
  if [[ ! -f "$out_overlay_png" ]]; then
    echo "warning: region-overlay screenshot not produced at $out_overlay_png" >&2
    out_overlay_png=""
  fi
else
  echo "note: overlay.js not found at $OVERLAY_JS — skipping overlay" >&2
  out_overlay_png=""
fi

echo "region map:  $out_json"
echo "screenshot:  $out_png"
[[ -n "$out_overlay_png" ]] && echo "overlay:     $out_overlay_png"
[[ -s "$out_txt" ]] && echo "annotated:   ${base}-annotated.png  (legend: $out_txt)"
