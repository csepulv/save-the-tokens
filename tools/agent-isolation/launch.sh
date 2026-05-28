#!/usr/bin/env bash
# launch.sh — Run, resume, or attach to an agent-isolation container.
#
# Usage:
#   ./launch.sh --config <name>.agent.yml
#   ./launch.sh --config <name>.agent.yml --name custom-name
#   ./launch.sh --config <name>.agent.yml --autonomous "<prompt>"
#   ./launch.sh --config <name>.agent.yml --resume
#   ./launch.sh --config <name>.agent.yml --build
#   ./launch.sh --config <name>.agent.yml --dry-run
#
# Auto-detects a single *.agent.yml in cwd (or the tool dir) when
# --config is omitted. See agent.yml.example for the config schema.

set -euo pipefail
. "$(dirname "$0")/config.sh"
. "$(dirname "$0")/services.sh"

# ── Defaults ────────────────────────────────────────────────────────
CONFIG_FILE=""
CONTAINER_NAME=""
AUTONOMOUS=""
RESUME=false
DO_BUILD=false
DRY_RUN=false

# ── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)      CONFIG_FILE="$2"; shift 2 ;;
    --name)        CONTAINER_NAME="$2"; shift 2 ;;
    --autonomous)  AUTONOMOUS="$2"; shift 2 ;;
    --resume)      RESUME=true; shift ;;
    --build)       DO_BUILD=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)
      # Print the usage header (comment lines after the shebang, up to the
      # first blank line). awk, not sed -n '{...}' — the latter is not
      # portable to BSD/macOS sed.
      awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Resolve config file ─────────────────────────────────────────────
CONFIG_FILE=$(resolve_config_file "${CONFIG_FILE}") || exit 1

# ── Read services / network from config (mutually exclusive) ───────
SERVICES_FILE=$(parse_config_setting "${CONFIG_FILE}" services)
NETWORK=$(parse_config_setting "${CONFIG_FILE}" network)

if [[ -n "${SERVICES_FILE}" && -n "${NETWORK}" ]]; then
  echo "Error: 'services' and 'network' in ${CONFIG_FILE} are mutually exclusive."
  echo "  'services' uses the network declared in its compose file automatically."
  exit 1
fi

if [[ -n "${SERVICES_FILE}" ]]; then
  SERVICES_FILE=$(resolve_services_file "${SERVICES_FILE}") || exit 1
  # The compose file is the source of truth for the network name; the agent
  # joins whatever 'external' network the services file declares.
  NETWORK=$(compose_external_network "${SERVICES_FILE}") || exit 1
fi

# ── Session helpers ─────────────────────────────────────────────────
warn_if_wrong_network() {
  [[ -z "${NETWORK}" ]] && return 0
  if ! agent_on_network "${CONTAINER_NAME}" "${NETWORK}"; then
    echo "Warning: ${CONTAINER_NAME} is not on network '${NETWORK}'."
    echo "  Services will be unreachable from it. To fix, recreate it:"
    echo "    docker rm ${CONTAINER_NAME}   # then relaunch"
  fi
}

finish_session() {
  local state agent_running="false" is_autonomous="false"
  state="$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  [[ "${state}" == "running" ]] && agent_running="true"
  [[ -n "${AUTONOMOUS}" ]] && is_autonomous="true"
  post_session "${SERVICES_FILE}" "${NETWORK}" "${agent_running}" "${is_autonomous}" || true
}

# ── Parse mounts ────────────────────────────────────────────────────
# Single iteration produces: docker -v flags, FIRST_RW for the cwd,
# and the claude bind-mount source (AGENT_CONFIG_DIR).
VOLUME_FLAGS=()
FIRST_RW_NAME=""
FIRST_RW_PATH=""
AGENT_CONFIG_DIR=""

MOUNTS_PARSED=$(parse_config_mounts "${CONFIG_FILE}") || exit 1

while IFS=$'\t' read -r host_path mode container_path name; do
  [[ -z "${mode}" ]] && continue
  case "${mode}" in
    claude)
      # Bind-mounted at AGENT_HOME/.claude by the dedicated -v below.
      AGENT_CONFIG_DIR="${host_path}"
      continue
      ;;
    rw)
      docker_mode="rw"
      if [[ -z "${FIRST_RW_NAME}" ]]; then
        FIRST_RW_NAME="${name}"
        FIRST_RW_PATH="${container_path}"
      fi
      ;;
    ro|mcp)
      # MCP mounts use the same container-side semantics as ro mounts.
      # The host→container path rewrite in .claude.json / settings.json
      # is handled by sync-config.sh Phase C, not by a runtime sed pass.
      docker_mode="ro"
      ;;
  esac
  VOLUME_FLAGS+=("-v" "${host_path}:${container_path}:${docker_mode}")
done <<< "${MOUNTS_PARSED}"

if [[ -z "${FIRST_RW_NAME}" ]]; then
  echo "Error: No rw mount in ${CONFIG_FILE}. At least one is required."
  exit 1
fi

# ── Container name (precedence: --name > config > derive from filename) ─
if [[ -z "${CONTAINER_NAME}" ]]; then
  CONTAINER_NAME=$(parse_config_setting "${CONFIG_FILE}" container_name)
  [[ -z "${CONTAINER_NAME}" ]] && CONTAINER_NAME=$(default_container_name_from_config "${CONFIG_FILE}")
fi

# ── Container hostname (config hostname > CONTAINER_NAME) ──────────
HOSTNAME_OVERRIDE=$(parse_config_setting "${CONFIG_FILE}" hostname)
CONTAINER_HOSTNAME="${HOSTNAME_OVERRIDE:-${CONTAINER_NAME}}"

# ── Per-container runtime state dir (host-side; bind-mounted RO) ────
# Holds agent-isolation runtime data the container reads but should not
# accumulate inside the persistent claude config dir. Currently:
#   on-start.json — the on_start block from the agent config, refreshed
#                   on every launch (fresh and resume) so YAML edits
#                   take effect without `docker rm`.
# Container path: /home/agent/.agent-isolation/  (read-only mount).
STATE_DIR="${HOME}/.agent-isolation/state/${CONTAINER_NAME}"
mkdir -p "${STATE_DIR}"

ON_START_JSON=$(parse_config_on_start_json "${CONFIG_FILE}")
if [[ "${ON_START_JSON}" == "null" ]]; then
  rm -f "${STATE_DIR}/on-start.json"
else
  printf '%s\n' "${ON_START_JSON}" > "${STATE_DIR}/on-start.json"
fi

# ── Build if requested ──────────────────────────────────────────────
if [[ "${DO_BUILD}" == true ]]; then
  "${TOOLS_DIR}/build-image.sh"
fi

# ── Start services if configured (Mode A) ──────────────────────────
if [[ -n "${SERVICES_FILE}" ]]; then
  if [[ "${DRY_RUN}" == true ]]; then
    echo "Dry run — would start services from ${SERVICES_FILE} on ${NETWORK}"
  else
    ensure_services_up "${SERVICES_FILE}" "${NETWORK}"
  fi
fi

# ── Check for existing container ────────────────────────────────────
EXISTING_STATE=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
EXISTING_STATE="${EXISTING_STATE:-absent}"

case "${EXISTING_STATE}" in
  running)
    echo "Container ${CONTAINER_NAME} is running. Attaching..."
    if [[ "${DRY_RUN}" == true ]]; then
      echo "docker exec -it ${CONTAINER_NAME} zsh"
      exit 0
    fi
    warn_if_wrong_network
    docker exec -it "${CONTAINER_NAME}" zsh || true
    finish_session
    exit 0
    ;;
  exited|created)
    echo "Container ${CONTAINER_NAME} exists (${EXISTING_STATE}). Resuming..."
    if [[ "${DRY_RUN}" == true ]]; then
      echo "docker start -ai ${CONTAINER_NAME}"
      exit 0
    fi
    warn_if_wrong_network
    docker start -ai "${CONTAINER_NAME}" || true
    finish_session
    exit 0
    ;;
  absent)
    # Fall through to create
    ;;
  *)
    echo "Container ${CONTAINER_NAME} is in unexpected state: ${EXISTING_STATE}"
    echo "Run: docker rm ${CONTAINER_NAME}"
    exit 1
    ;;
esac

# ── Preflight ───────────────────────────────────────────────────────
if [[ -n "${AGENT_CONFIG_DIR}" && ! -d "${AGENT_CONFIG_DIR}" ]]; then
  echo "Error: ${AGENT_CONFIG_DIR} not found."
  echo "Run sync-config.sh first."
  exit 1
fi

if [[ -z "${AGENT_CONFIG_DIR}" ]]; then
  echo "Warning: No 'claude' mount in ${CONFIG_FILE}."
  echo "  Container will use ephemeral ~/.claude (not preserved between runs)."
fi

if ! docker image inspect "${IMAGE_NAME}:latest" &>/dev/null; then
  echo "Image ${IMAGE_NAME}:latest not found. Building..."
  "${TOOLS_DIR}/build-image.sh"
fi

# ── Find available host port for Slack OAuth ────────────────────────
# The container-side port is always SLACK_OAUTH_PORT (3118), matching
# the callbackPort in settings.json. The host-side port auto-increments
# if already in use by another container.
OAUTH_HOST_PORT="${SLACK_OAUTH_PORT}"
while docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:${OAUTH_HOST_PORT}->"; do
  ((OAUTH_HOST_PORT++))
done
if [[ "${OAUTH_HOST_PORT}" -ne "${SLACK_OAUTH_PORT}" ]]; then
  echo "Note: Port ${SLACK_OAUTH_PORT} in use. Slack OAuth on host port ${OAUTH_HOST_PORT}."
  echo "  You may need to update the OAuth callback URL to use port ${OAUTH_HOST_PORT}."
fi

# ── Build docker run command ────────────────────────────────────────
CMD=(
  docker run
  --name "${CONTAINER_NAME}"
  --hostname "${CONTAINER_HOSTNAME}"
  -it
)

if [[ -n "${AGENT_CONFIG_DIR}" ]]; then
  CMD+=(-v "${AGENT_CONFIG_DIR}:${AGENT_HOME}/.claude:rw")
fi

CMD+=(-v "${STATE_DIR}:${AGENT_HOME}/.agent-isolation:ro")

CMD+=(
  "${VOLUME_FLAGS[@]}"
  -w "${FIRST_RW_PATH}"
  -p "${OAUTH_HOST_PORT}:${SLACK_OAUTH_PORT}"
)

# Extra ports from config
CONFIG_PORTS=$(parse_config_ports "${CONFIG_FILE}")
while IFS= read -r port; do
  [[ -z "${port}" ]] && continue
  CMD+=(-p "${port}")
done <<< "${CONFIG_PORTS}"

# Env vars from config
CONFIG_ENV=$(parse_config_env "${CONFIG_FILE}")
while IFS= read -r env; do
  [[ -z "${env}" ]] && continue
  CMD+=(-e "${env}")
done <<< "${CONFIG_ENV}"

# Service / agent network
if [[ -n "${NETWORK}" ]]; then
  CMD+=(--network "${NETWORK}")
fi

CMD+=("${IMAGE_NAME}:latest")

# ── Determine CMD to run inside container ───────────────────────────
if [[ -n "${AUTONOMOUS}" ]]; then
  CMD+=(claude -p "${AUTONOMOUS}" --dangerously-skip-permissions)
elif [[ "${RESUME}" == true ]]; then
  CMD+=(claude --dangerously-skip-permissions --continue)
else
  # Interactive: drop to bash, user runs claude manually
  CMD+=(bash)
fi

# ── Execute or print ────────────────────────────────────────────────
echo ""
echo "Config:      ${CONFIG_FILE}"
echo "Container:   ${CONTAINER_NAME}"
echo "Hostname:    ${CONTAINER_HOSTNAME}"
echo "Working dir: ${FIRST_RW_PATH}"
if [[ -n "${AGENT_CONFIG_DIR}" ]]; then
  echo "Claude cfg:  ${AGENT_CONFIG_DIR} → ${AGENT_HOME}/.claude"
else
  echo "Claude cfg:  ephemeral (not persisted)"
fi
if [[ -n "${NETWORK}" ]]; then
  echo "Network:     ${NETWORK}"
fi
echo ""

if [[ "${DRY_RUN}" == true ]]; then
  echo "Dry run — would execute:"
  echo "  ${CMD[*]}"
  exit 0
fi

if [[ -z "${AUTONOMOUS}" ]]; then
  echo "Run inside container: claude --dangerously-skip-permissions"
  echo ""
fi

# Run as a child (not exec) so finish_session runs after the container
# exits. Capture the container's exit code to propagate it.
RUN_EXIT=0
"${CMD[@]}" || RUN_EXIT=$?
finish_session
exit "${RUN_EXIT}"
