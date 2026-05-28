#!/usr/bin/env bash
# entrypoint.sh — Container runtime setup.
#
# Handles Linux vs macOS Claude Code differences:
#   - Symlinks ~/.claude.json into the mounted ~/.claude/ for persistence
#   - Restores from backup if .claude.json is missing
#   - Sets git identity
#   - Verifies config mount exists
#   - Runs on_start if launch.sh staged one (see ~/.agent-isolation/)
#
# Runs as the 'agent' user inside the container.

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
CLAUDE_JSON="${HOME}/.claude.json"
CLAUDE_JSON_INNER="${CLAUDE_DIR}/.claude.json"
STATE_DIR="${HOME}/.agent-isolation"
ON_START_FILE="${STATE_DIR}/on-start.json"

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

# MCP path rewriting used to happen here via a launch-written
# `.mcp-path-map` and a sed loop. Retired in M2: sync-config.sh Phase C
# rewrites those paths once, at sync time, in the host-side
# agent-claude/.claude.json (and the other config files). No runtime
# rewrite needed.

# ── Git identity ───────────────────────────────────────────────────
git config --global user.name "${GIT_AUTHOR_NAME:-claude-agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@localhost}"

# ── on_start (optional) ────────────────────────────────────────────
# launch.sh writes on-start.json from the agent config's on_start block
# into the host-side state dir, which is bind-mounted RO at
# ${STATE_DIR} (i.e., ~/.agent-isolation/). Refreshes on every launch
# (fresh + resume) so YAML edits take effect without a recreate.
if [[ -f "${ON_START_FILE}" ]]; then
  on_start_cmd=$(jq -r '.command' "${ON_START_FILE}")
  on_start_log=$(jq -r '.log // "/tmp/agent-on-start.log"' "${ON_START_FILE}")
  env_pairs=()
  while IFS=$'\t' read -r k v; do
    [[ -n "${k}" ]] && env_pairs+=("${k}=${v}")
  done < <(jq -r '.env // {} | to_entries[] | "\(.key)\t\(.value)"' "${ON_START_FILE}")
  if [[ ${#env_pairs[@]} -gt 0 ]]; then
    env "${env_pairs[@]}" nohup bash -c "${on_start_cmd}" > "${on_start_log}" 2>&1 &
  else
    nohup bash -c "${on_start_cmd}" > "${on_start_log}" 2>&1 &
  fi
  disown
  echo "on_start: ${on_start_cmd} (log: ${on_start_log})"
fi

# ── Hand off to CMD ────────────────────────────────────────────────
exec "$@"
