#!/usr/bin/env bash
# compare.sh — compare two region-map JSONs into a delta JSON.
#
# Usage:
#   ./compare.sh <ref-map.json> <impl-map.json> [output-dir] [name-stem]
#
# Examples:
#   # Default: writes ./comparisons/compare-<ts>.delta.json
#   ./compare.sh ref-map.json impl-map.json
#
#   # Custom output dir:
#   ./compare.sh ref-map.json impl-map.json ./out
#
#   # Custom stem (useful for stable-named fixture outputs):
#   ./compare.sh ref-map.json impl-map.json ./out ref-vs-impl
#
# Output: <output-dir>/<name-stem>.delta.json

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <ref-map.json> <impl-map.json> [output-dir] [name-stem]" >&2
  exit 2
fi

REF="$1"
IMPL="$2"
OUT_DIR="${3:-./comparisons}"
NAME_STEM="${4:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMP_JS="${SCRIPT_DIR}/compare.js"

if [[ ! -f "$CMP_JS" ]]; then
  echo "compare.js not found next to this script: $CMP_JS" >&2
  exit 1
fi
if [[ ! -f "$REF" ]]; then
  echo "reference map not found: $REF" >&2
  exit 1
fi
if [[ ! -f "$IMPL" ]]; then
  echo "implementation map not found: $IMPL" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || {
  echo "node not on PATH" >&2
  exit 1
}

mkdir -p "$OUT_DIR"

if [[ -n "$NAME_STEM" ]]; then
  node "$CMP_JS" "$REF" "$IMPL" "$OUT_DIR" "$NAME_STEM"
else
  node "$CMP_JS" "$REF" "$IMPL" "$OUT_DIR"
fi
