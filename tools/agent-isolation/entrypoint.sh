#!/usr/bin/env bash
# entrypoint.sh — Container runtime setup.
#
# Handles Linux vs macOS Claude Code differences:
#   - Symlinks ~/.claude.json into the mounted ~/.claude/ for persistence
#   - Restores from backup if .claude.json is missing
#   - Sets git identity
#   - Verifies config mount exists
#
# Runs as the 'agent' user inside the container.

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
CLAUDE_JSON="${HOME}/.claude.json"
CLAUDE_JSON_INNER="${CLAUDE_DIR}/.claude.json"

# ── Verify config mount ────────────────────────────────────────────
if [[ ! -f "${CLAUDE_DIR}/settings.json" ]]; then
  echo "Error: ${CLAUDE_DIR}/settings.json not found."
  echo "The agent-claude/ volume must be mounted at ${CLAUDE_DIR}."
  echo "Run sync-config.sh first, then launch with the correct mount."
  exit 1
fi

# ── Restore .claude.json from backup if needed ─────────────────────
# On Linux, Claude Code stores user profile state in ~/.claude.json
# (separate from ~/.claude/). If the file is missing but backups
# exist from a previous session, restore the most recent one.
if [[ ! -f "${CLAUDE_JSON_INNER}" && -d "${CLAUDE_DIR}/backups" ]]; then
  LATEST_BACKUP=$(find "${CLAUDE_DIR}/backups" -name "*.backup.*" -type f -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1 || true)
  if [[ -n "${LATEST_BACKUP}" ]]; then
    cp "${LATEST_BACKUP}" "${CLAUDE_JSON_INNER}"
    echo "Restored .claude.json from backup"
  fi
fi

# ── Symlink ~/.claude.json → ~/.claude/.claude.json ────────────────
# This ensures the Linux-expected path persists via the volume mount.
if [[ -f "${CLAUDE_JSON}" && ! -L "${CLAUDE_JSON}" ]]; then
  # A real file exists outside the mount — move it in
  mv "${CLAUDE_JSON}" "${CLAUDE_JSON_INNER}"
fi
ln -sf "${CLAUDE_JSON_INNER}" "${CLAUDE_JSON}"

# ── Rewrite MCP server paths ───────────────────────────────────────
# launch.sh writes a mapping file when mcp mounts are declared.
# Each line: host_path|container_path
# We rewrite these in .claude.json so MCP server commands point to
# the container mount paths instead of the host's absolute paths.
MCP_MAP="${CLAUDE_DIR}/.mcp-path-map"
if [[ -f "${MCP_MAP}" && -f "${CLAUDE_JSON_INNER}" ]]; then
  while IFS='|' read -r host_path container_path; do
    [[ -z "${host_path}" ]] && continue
    sed -i "s|${host_path}|${container_path}|g" "${CLAUDE_JSON_INNER}"
  done < "${MCP_MAP}"
  echo "Rewrote MCP paths in .claude.json"
fi

# ── Git identity ───────────────────────────────────────────────────
git config --global user.name "${GIT_AUTHOR_NAME:-claude-agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@localhost}"

# ── Hand off to CMD ────────────────────────────────────────────────
exec "$@"
