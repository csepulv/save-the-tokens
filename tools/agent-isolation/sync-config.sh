#!/usr/bin/env bash
# sync-config.sh — Sync ~/.claude/ to agent-claude/ with transforms.
#
# Five phases:
#   A) rsync with exclusions (settings.json excluded — composed in B)
#   B) Compose container settings.json (template + selected host fields)
#   C) Path rewriting in all synced config files, driven by the agent config
#   D) MCP server injection for enabled external plugins
#   E) Warn about host paths still uncovered by any mount
#
# By default, syncs config (skills, rules, plugins) but preserves
# existing projects/sessions in the target. This allows re-running to update
# config without losing container session history.
#
# Usage:
#   ./sync-config.sh --config <name>.agent.yml   # specific agent config
#   ./sync-config.sh                             # auto-detect single *.agent.yml
#   ./sync-config.sh --include-all               # copy everything (projects/sessions/plans/…)
#   ./sync-config.sh --force                     # wipe target and sync fresh
#   ./sync-config.sh --source ~/.work-claude     # sync from alternate claude config dir
#   ./sync-config.sh --headless                  # strip statusLine (for autonomous/headless runs)

set -euo pipefail
. "$(dirname "$0")/config.sh"

# ── Parse flags ─────────────────────────────────────────────────────
FORCE=false
HEADLESS=false
INCLUDE_ALL=false
CONFIG_ARG=""
SOURCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)             FORCE=true; shift ;;
    --headless)          HEADLESS=true; shift ;;
    --include-all)       INCLUDE_ALL=true; shift ;;
    --config)            CONFIG_ARG="$2"; shift 2 ;;
    --source)            SOURCE_DIR="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Resolve source config dir ──────────────────────────────────────
if [[ -n "${SOURCE_DIR}" ]]; then
  SOURCE_DIR="${SOURCE_DIR/#\~/${HOME}}"
  HOST_CLAUDE="${SOURCE_DIR}"
fi

# ── Resolve agent config + parse mounts once ───────────────────────
CONFIG_FILE=$(resolve_config_file "${CONFIG_ARG}") || exit 1
MOUNTS_PARSED=$(parse_config_mounts "${CONFIG_FILE}") || exit 1

# Extract the claude mount's host path (the agent-claude bind-mount source).
AGENT_CONFIG_DIR=""
while IFS=$'\t' read -r _host_path _mode _container_path _name; do
  if [[ "${_mode}" == "claude" ]]; then
    AGENT_CONFIG_DIR="${_host_path}"
    break
  fi
done <<< "${MOUNTS_PARSED}"

if [[ -z "${AGENT_CONFIG_DIR}" ]]; then
  echo "Warning: No 'claude' mount in ${CONFIG_FILE}."
  echo "  Container will use ephemeral ~/.claude (not preserved between runs)."
  echo "  Add a mount with mode: claude to persist config, sessions, and history."
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
  --exclude='/settings.json'
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

# Write the container's local-additional-context.md (environment facts
# for the in-container agent — mount paths, service-name DNS, etc.).
# The host has its own version at the same relative path with different
# content; sync overwrites the container side with the agent-isolation
# template. Prefers live file over .example, same pattern as agent.yml.
CTX_TEMPLATE=""
if [[ -f "${TOOLS_DIR}/local-additional-context.md" ]]; then
  CTX_TEMPLATE="${TOOLS_DIR}/local-additional-context.md"
elif [[ -f "${TOOLS_DIR}/local-additional-context.md.example" ]]; then
  CTX_TEMPLATE="${TOOLS_DIR}/local-additional-context.md.example"
fi
if [[ -n "${CTX_TEMPLATE}" ]]; then
  mkdir -p "${AGENT_CONFIG_DIR}/rules"
  cp "${CTX_TEMPLATE}" "${AGENT_CONFIG_DIR}/rules/local-additional-context.md"
  echo "  wrote rules/local-additional-context.md (container content)"
fi

# ── Phase B: Compose settings.json (template + host overlay) ───────
# Host settings.json is NOT rsynced (host is protective; container is
# broadly permissive — different stance). Compose from a container
# template plus a whitelist of host fields (plugins, marketplaces,
# preferences — NOT permissions/hooks). Phase D injects MCP servers
# on top.
SETTINGS="${AGENT_CONFIG_DIR}/settings.json"
HOST_SETTINGS="${HOST_CLAUDE}/settings.json"

# Resolve template: live > .example. Same pattern as agent.yml.
SETTINGS_TEMPLATE=""
if [[ -f "${TOOLS_DIR}/settings.container.json" ]]; then
  SETTINGS_TEMPLATE="${TOOLS_DIR}/settings.container.json"
elif [[ -f "${TOOLS_DIR}/settings.container.json.example" ]]; then
  SETTINGS_TEMPLATE="${TOOLS_DIR}/settings.container.json.example"
  echo "  using settings.container.json.example (copy to settings.container.json to customize)"
else
  echo "Error: No settings.container.json[.example] template in ${TOOLS_DIR}." >&2
  exit 1
fi

if [[ -f "${HOST_SETTINGS}" ]]; then
  # Overlay whitelist: plugin/marketplace/preference fields from host.
  # Intentionally excludes permissions, hooks (template carries the
  # container stance; junkdrawer hook can't run in container).
  jq -s '
    .[0] + (.[1] | with_entries(
      select(.key | IN(
        "enabledPlugins", "extraKnownMarketplaces", "statusLine",
        "voice", "voiceEnabled", "agentPushNotifEnabled",
        "effortLevel", "skillListingBudgetFraction", "env"
      ))
    ))
  ' "${SETTINGS_TEMPLATE}" "${HOST_SETTINGS}" > "${SETTINGS}.tmp" \
    && mv "${SETTINGS}.tmp" "${SETTINGS}"
  echo "  composed settings.json (template + host overlay)"
else
  cp "${SETTINGS_TEMPLATE}" "${SETTINGS}"
  echo "  copied template to settings.json (no host settings.json to overlay)"
fi

# ── Phase C: Path rewriting ─────────────────────────────────────────
# Driven by the agent config's mounts. Each declared mount produces a
# host→container mapping; the same jq walk rewrites string values across
# all target files. Replaces the old HOST_CLAUDE-only sed pass.

# Build host=container pairs from the already-parsed mounts (MOUNTS_PARSED
# was computed near the top from parse_config_mounts).
# Always seed with HOST_CLAUDE → AGENT_HOME/.claude — that's where the
# data was rsynced FROM, so references inside (e.g. installed_plugins.json's
# installPath) point at HOST_CLAUDE and must be rewritten. The `claude`
# mount names the bind-mount SOURCE (agent-claude dir), which is the
# destination of the rsync, not the origin; skip it here.
MAPPINGS=("${HOST_CLAUDE}=${AGENT_HOME}/.claude")
while IFS=$'\t' read -r host_path mode container_path name; do
  [[ -z "${mode}" || "${mode}" == "claude" ]] && continue
  MAPPINGS+=("${host_path}=${container_path}")
done <<< "${MOUNTS_PARSED}"

# Rewrite host paths to container paths in a JSON file, atomically.
# Args: file, then N host=container mapping pairs.
# No-op if file doesn't exist or no mappings.
rewrite_paths_in_file() {
  local file="$1"; shift
  [[ -f "${file}" ]] || return 0
  [[ $# -eq 0 ]] && return 0

  local jq_filter='walk(if type == "string" then'
  local first=true
  for pair in "$@"; do
    local host="${pair%%=*}"
    local container="${pair#*=}"
    if [[ "${first}" == true ]]; then
      jq_filter+=" if startswith(\"${host}\")"
      first=false
    else
      jq_filter+=" elif startswith(\"${host}\")"
    fi
    jq_filter+=" then \"${container}\" + ltrimstr(\"${host}\")"
  done
  jq_filter+=" else . end else . end)"

  jq "${jq_filter}" "${file}" > "${file}.tmp" && mv "${file}.tmp" "${file}"
}

if [[ ${#MAPPINGS[@]} -gt 0 ]]; then
  for target in \
    "${AGENT_CONFIG_DIR}/plugins/installed_plugins.json" \
    "${AGENT_CONFIG_DIR}/plugins/known_marketplaces.json" \
    "${AGENT_CONFIG_DIR}/settings.json" \
    "${AGENT_CONFIG_DIR}/.claude.json"; do
    if [[ -f "${target}" ]]; then
      rewrite_paths_in_file "${target}" "${MAPPINGS[@]}"
      echo "  rewrote paths in $(basename "${target}")"
    fi
  done
fi

# ── Phase D: MCP injection ──────────────────────────────────────────
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
        # Plugin .mcp.json files come in two shapes: wrapped
        # ({"mcpServers": {"name": …}}) like discord, or unwrapped
        # ({"name": …}) like context7/asana/firebase/github/etc.
        # Unwrap if wrapped; merge the inner map either way.
        MCP_MERGE=$(echo "${MCP_MERGE}" | jq --slurpfile mcp "${mcp_file}" '. * ($mcp[0].mcpServers // $mcp[0])')
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

# ── Phase E: Warn about unmapped host paths ────────────────────────
# Any remaining ${HOME}/... strings in the synced config files mean
# Phase C had no mount-driven mapping for them. Container will see
# broken references — diagnostic, not a hard error.
#
# `.claude.json` is intentionally NOT in this sweep. It accumulates
# cosmetic host paths (recent project cwds, etc.) that don't need to
# be mounted into the container; Phase C rewrites the paths that DO
# matter (MCP server commands), and the rest stay stale without harm.
for target in \
  "${AGENT_CONFIG_DIR}/plugins/installed_plugins.json" \
  "${AGENT_CONFIG_DIR}/plugins/known_marketplaces.json" \
  "${AGENT_CONFIG_DIR}/settings.json"; do
  [[ -f "${target}" ]] || continue
  # grep exits 1 on no-match; with `set -o pipefail` that aborts the
  # script silently inside `$(…)`. `|| true` lets the empty case pass.
  first_hit=$(grep -oE "${HOME}[^\"]*" "${target}" 2>/dev/null | head -1 || true)
  if [[ -n "${first_hit}" ]]; then
    echo "  Warning: host path in $(basename "${target}") not covered by any mount:" >&2
    echo "    ${first_hit}" >&2
    echo "    Add the appropriate 'ro' (or 'rw') mount to make it reachable from the container." >&2
  fi
done

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
