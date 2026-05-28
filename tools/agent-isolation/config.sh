#!/usr/bin/env bash
# config.sh — Shared constants for agent-isolation container tooling.
# Sourced by all other scripts: . "$(dirname "$0")/config.sh"

# Docker image
IMAGE_NAME="claude-agent"
CONTAINER_PREFIX="agent"

# Container user
AGENT_USER="agent"
AGENT_HOME="/home/agent"

# Host paths
HOST_CLAUDE="${HOME}/.claude"

# Container mount conventions
WORKSPACE_MOUNT="/workspace"
REFERENCE_MOUNT="/reference"
MCP_MOUNT="/mcp"

# Ports
SLACK_OAUTH_PORT=3118

# Script directory (for locating sibling files)
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Config helpers ──────────────────────────────────────────────────
# Per-container config is a single YAML file:  <name>.agent.yml.
# Schema reference: tools/agent-isolation/agent.yml.example
# Parses via `yq` (mikefarah, v4+); requires `yq` on PATH.

# Locate the agent config file. Checks explicit path, then cwd, then tools dir.
# Errors if multiple *.agent.yml files in either location (user must be
# explicit when ambiguous).
# Usage:  CONFIG=$(resolve_config_file "${explicit_path}") || exit 1
resolve_config_file() {
  local explicit="${1:-}"
  if [[ -n "${explicit}" ]]; then
    if [[ ! -f "${explicit}" ]]; then
      echo "Error: Config file not found: ${explicit}" >&2
      return 1
    fi
    echo "${explicit}"
    return 0
  fi
  local matches=()
  shopt -s nullglob
  matches=(*.agent.yml)
  shopt -u nullglob
  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "Error: Multiple *.agent.yml files in cwd. Use --config <file>." >&2
    return 1
  elif [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"
    return 0
  fi
  # Fall back to tool dir.
  shopt -s nullglob
  matches=("${TOOLS_DIR}"/*.agent.yml)
  shopt -u nullglob
  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "Error: Multiple *.agent.yml files in ${TOOLS_DIR}. Use --config <file>." >&2
    return 1
  elif [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"
    return 0
  fi
  echo "Error: No *.agent.yml found in cwd or ${TOOLS_DIR}. Use --config <file>." >&2
  return 1
}

# Parse the mounts list. Emits one tab-separated line per mount:
#   <host_path>\t<mode>\t<container_path>\t<name>
#
# Errors on invalid mode or unresolvable path.
parse_config_mounts() {
  local config_file="$1"
  local lines host mode target name container_path
  lines=$(yq -o=json '.mounts // []' "${config_file}" \
          | jq -r '.[] | "\(.host)\t\(.mode)\t\(.target // "")"')
  [[ -z "${lines}" ]] && return 0
  while IFS=$'\t' read -r host mode target; do
    host="${host/#\~/${HOME}}"
    if [[ ! "${host}" = /* ]]; then
      host="$(cd "${host}" 2>/dev/null && pwd)" || {
        echo "Error: Cannot resolve path: ${host}" >&2
        return 1
      }
    fi
    case "${mode}" in
      claude)
        name="${target:-claude}"
        container_path="${AGENT_HOME}/.claude"
        ;;
      rw)
        name="${target:-$(basename "${host}")}"
        container_path="${WORKSPACE_MOUNT}/${name}"
        ;;
      ro)
        name="${target:-$(basename "${host}")}"
        container_path="${REFERENCE_MOUNT}/${name}"
        ;;
      mcp)
        name="${target:-$(basename "${host}")}"
        container_path="${MCP_MOUNT}/${name}"
        ;;
      *)
        echo "Error: Invalid mount mode '${mode}' for ${host}. Use claude/rw/ro/mcp." >&2
        return 1
        ;;
    esac
    printf '%s\t%s\t%s\t%s\n' "${host}" "${mode}" "${container_path}" "${name}"
  done <<< "${lines}"
}

# Read a top-level scalar (hostname, container_name, services, network,
# settings_template). Returns the empty string if not set.
parse_config_setting() {
  local config_file="$1"
  local key="$2"
  yq -r ".${key} // \"\"" "${config_file}"
}

# Emit ports as host:container per line. Schema accepts numbers
# (auto-doubled, e.g. 5173 → 5173:5173) or "host:container" strings.
parse_config_ports() {
  local config_file="$1"
  yq -o=json '.ports // []' "${config_file}" \
    | jq -r '.[] | if type == "number" then "\(.):\(.)" else . end'
}

# Emit env entries as KEY=value per line. Empty if env block is absent.
parse_config_env() {
  local config_file="$1"
  yq -o=json '.env // {}' "${config_file}" \
    | jq -r 'to_entries[] | "\(.key)=\(.value)"'
}

# Emit the on_start block as a JSON object, or the string "null" if not
# present. Caller writes the result verbatim to <agent-claude>/.on-start
# for entrypoint.sh to consume at container start.
parse_config_on_start_json() {
  local config_file="$1"
  yq -o=json '.on_start // null' "${config_file}"
}

# Container name default derived from the config filename:
#   tsugi.agent.yml → agent-tsugi
# Honors explicit `container_name:` key in the config (precedence wins
# is handled by the caller — this helper just gives the filename-derived
# default).
default_container_name_from_config() {
  local config_file="$1"
  local base
  base="$(basename "${config_file}")"
  base="${base%.agent.yml}"
  echo "${CONTAINER_PREFIX}-${base}"
}
