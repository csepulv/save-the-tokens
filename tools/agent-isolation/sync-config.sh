#!/usr/bin/env bash
# sync-config.sh — Sync ~/.claude/ to agent-claude/ with transforms.
#
# Three phases:
#   A) rsync with exclusions
#   B) Path rewriting in installed_plugins.json
#   C) MCP server injection for enabled external plugins
#
# By default, syncs config (settings, plugins, skills, rules) but preserves
# existing projects/sessions in the target. This allows re-running to update
# config without losing container session history.
#
# Usage:
#   ./sync-config.sh                           # sync config (preserves session data)
#   ./sync-config.sh --mounts rb.mounts.conf   # use specific mounts file
#   ./sync-config.sh --include-all             # copy everything including projects/sessions/plans
#   ./sync-config.sh --force                   # wipe target and sync fresh
#   ./sync-config.sh --source ~/.work-claude    # sync from alternate claude config dir
#   ./sync-config.sh --headless                # strip statusLine (for autonomous/headless runs)

set -euo pipefail
. "$(dirname "$0")/config.sh"

# ── Parse flags ─────────────────────────────────────────────────────
FORCE=false
HEADLESS=false
INCLUDE_ALL=false
MOUNTS_ARG=""
SOURCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)             FORCE=true; shift ;;
    --headless)          HEADLESS=true; shift ;;
    --include-all)       INCLUDE_ALL=true; shift ;;
    --mounts)            MOUNTS_ARG="$2"; shift 2 ;;
    --source)            SOURCE_DIR="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Resolve source config dir ──────────────────────────────────────
if [[ -n "${SOURCE_DIR}" ]]; then
  SOURCE_DIR="${SOURCE_DIR/#\~/${HOME}}"
  HOST_CLAUDE="${SOURCE_DIR}"
fi

# ── Resolve claude config path from mounts.conf ───────────────────
MOUNTS_FILE=$(resolve_mounts_file "${MOUNTS_ARG}") || {
  echo "Error: No mounts.conf found. Copy mounts.conf.example and edit it."
  exit 1
}

AGENT_CONFIG_DIR=$(parse_claude_config "${MOUNTS_FILE}") || exit 1

if [[ -z "${AGENT_CONFIG_DIR}" ]]; then
  echo "Warning: No 'claude' entry in ${MOUNTS_FILE}."
  echo "  Container will use ephemeral ~/.claude (not preserved between runs)."
  echo "  Add a line like:  ~/agent-workspace/agent-claude  claude"
  echo "  to persist config, sessions, and conversation history."
  exit 0
fi

# ── Preflight ───────────────────────────────────────────────────────
if [[ ! -d "${HOST_CLAUDE}" ]]; then
  echo "Error: ${HOST_CLAUDE} not found"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

if [[ -d "${AGENT_CONFIG_DIR}" && "${FORCE}" == true ]]; then
  echo "Wiping existing config at ${AGENT_CONFIG_DIR} (--force)"
  rm -rf "${AGENT_CONFIG_DIR}"
fi

echo "Syncing ${HOST_CLAUDE} → ${AGENT_CONFIG_DIR}"

# ── Phase A: rsync with exclusions ──────────────────────────────────
mkdir -p "${AGENT_CONFIG_DIR}"

# Build exclusion list — ephemeral data always excluded
RSYNC_EXCLUDES=(
  --exclude='__store.db'
  --exclude='debug/'
  --exclude='history.jsonl'
  --exclude='shell-snapshots/'
  --exclude='session-env/'
  --exclude='telemetry/'
  --exclude='statsig/'
  --exclude='stats-cache.json'
  --exclude='security_warnings_state_*.json'
  --exclude='ide/'
  --exclude='downloads/'
  --exclude='paste-cache/'
  --exclude='file-history/'
  --exclude='.DS_Store'
  --exclude='.credentials.json'
)

# Session-specific and ephemeral data excluded by default.
# These accumulate per-conversation and aren't useful to a fresh container.
# Use --include-all to copy everything (like the original behavior).
if [[ "${INCLUDE_ALL}" != true ]]; then
  RSYNC_EXCLUDES+=(
    --exclude='projects/'
    --exclude='sessions/'
    --exclude='plans/'
    --exclude='tasks/'
    --exclude='todos/'
    --exclude='usage-data/'
    --exclude='cache/'
    --exclude='backups/'
  )
  echo "  excluding session data (use --include-all to copy everything)"
fi

rsync -a "${RSYNC_EXCLUDES[@]}" "${HOST_CLAUDE}/" "${AGENT_CONFIG_DIR}/"
echo "  synced config"

# Credentials copied explicitly
if [[ -f "${HOST_CLAUDE}/.credentials.json" ]]; then
  cp "${HOST_CLAUDE}/.credentials.json" "${AGENT_CONFIG_DIR}/.credentials.json"
  echo "  copied .credentials.json"
fi

# Ensure directories exist for container writes (even when excluded from sync)
mkdir -p "${AGENT_CONFIG_DIR}"/{projects,sessions,backups,plans,tasks,todos,cache}

# ── Phase B: Path rewriting ─────────────────────────────────────────
INSTALLED="${AGENT_CONFIG_DIR}/plugins/installed_plugins.json"
if [[ -f "${INSTALLED}" ]]; then
  sed -i '' "s|${HOST_CLAUDE}|${AGENT_HOME}/.claude|g" "${INSTALLED}" 2>/dev/null || \
  sed -i "s|${HOST_CLAUDE}|${AGENT_HOME}/.claude|g" "${INSTALLED}"
  echo "  rewrote paths in installed_plugins.json"
fi

# ── Phase C: MCP injection ──────────────────────────────────────────
SETTINGS="${AGENT_CONFIG_DIR}/settings.json"
if [[ ! -f "${SETTINGS}" ]]; then
  echo "  Warning: settings.json not found, skipping MCP injection"
else
  # Build a jq filter that:
  # 1. Ensures mcpServers exists
  # 2. For each enabled external plugin, merges its .mcp.json
  # 3. Optionally strips statusLine for headless mode

  # Collect MCP configs from enabled external plugins.
  # Check enabledPlugins in settings.json, plus a known list of plugins
  # that are enabled via __store.db (which we exclude from sync).
  #
  # To add more, append to EXTRA_PLUGINS below.
  EXTRA_PLUGINS="slack"

  MCP_MERGE="{}"
  ENABLED_PLUGINS=$(jq -r '.enabledPlugins // {} | keys[]' "${SETTINGS}")
  MARKETPLACES_DIR="${AGENT_CONFIG_DIR}/plugins/marketplaces"

  # Build a lookup set of plugin names to inject
  declare -A INJECT_PLUGINS
  for plugin_key in ${ENABLED_PLUGINS}; do
    plugin_name="${plugin_key%%@*}"
    INJECT_PLUGINS["${plugin_name}"]=1
  done
  for name in ${EXTRA_PLUGINS}; do
    INJECT_PLUGINS["${name}"]=1
  done

  # Scan marketplace external plugins, inject only those in the set
  if [[ -d "${MARKETPLACES_DIR}" ]]; then
    for mcp_file in "${MARKETPLACES_DIR}"/*/external_plugins/*/.mcp.json; do
      [[ -f "${mcp_file}" ]] || continue
      plugin_name="$(basename "$(dirname "${mcp_file}")")"
      if [[ -n "${INJECT_PLUGINS[${plugin_name}]+x}" ]]; then
        MCP_MERGE=$(echo "${MCP_MERGE}" | jq --slurpfile mcp "${mcp_file}" '. * $mcp[0]')
        echo "  injected MCP: ${plugin_name}"
      fi
    done
  fi

  # Apply MCP merge and optional headless stripping
  if [[ "${HEADLESS}" == true ]]; then
    jq --argjson mcp "${MCP_MERGE}" \
      '.mcpServers = ((.mcpServers // {}) * $mcp) | del(.statusLine)' \
      "${SETTINGS}" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "${SETTINGS}"
    echo "  stripped statusLine (headless mode)"
  else
    jq --argjson mcp "${MCP_MERGE}" \
      '.mcpServers = ((.mcpServers // {}) * $mcp)' \
      "${SETTINGS}" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "${SETTINGS}"
  fi
  echo "  updated settings.json"
fi

# ── Summary ─────────────────────────────────────────────────────────
echo ""
echo "Done. Config ready at ${AGENT_CONFIG_DIR}"
echo ""
echo "Excluded (always): __store.db, debug/, history.jsonl, session-env/,"
echo "  shell-snapshots/, paste-cache/, file-history/, telemetry/, statsig/,"
echo "  ide/, downloads/"
if [[ "${INCLUDE_ALL}" != true ]]; then
  echo "Excluded (default): projects/, sessions/, plans/, tasks/, todos/,"
  echo "  usage-data/, cache/, backups/"
  echo "  Use --include-all to copy everything from source."
fi
