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

# ── Shared helpers ─────────────────────────────────────────────────

# Find a mounts.conf file. Checks explicit path, then cwd, then tools dir.
# Does NOT fall back to .example — callers handle that if desired.
# Usage: MOUNTS_FILE=$(resolve_mounts_file "${explicit_path}")
resolve_mounts_file() {
  local explicit="${1:-}"
  if [[ -n "${explicit}" ]]; then
    if [[ ! -f "${explicit}" ]]; then
      echo "Error: Mounts file not found: ${explicit}" >&2
      return 1
    fi
    echo "${explicit}"
  elif [[ -f "mounts.conf" ]]; then
    echo "mounts.conf"
  elif [[ -f "${TOOLS_DIR}/mounts.conf" ]]; then
    echo "${TOOLS_DIR}/mounts.conf"
  else
    return 1
  fi
}

# Parse the claude config path from a mounts file.
# Prints the expanded path (or empty string if no claude entry).
# Errors if multiple claude entries found.
parse_claude_config() {
  local mounts_file="$1"
  local claude_path=""
  local count=0

  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "${line}" | xargs)"
    [[ -z "${line}" ]] && continue

    read -r host_path mode _name <<< "${line}"
    if [[ "${mode}" == "claude" ]]; then
      ((count++))
      host_path="${host_path/#\~/${HOME}}"
      claude_path="${host_path}"
    fi
  done < "${mounts_file}"

  if [[ "${count}" -gt 1 ]]; then
    echo "Error: Multiple 'claude' entries in ${mounts_file}. Only one allowed." >&2
    return 1
  fi

  echo "${claude_path}"
}
