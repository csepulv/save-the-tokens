#!/usr/bin/env bash
# launch.sh — Run, resume, or attach to a michi agent container.
#
# Usage:
#   ./launch.sh                              # interactive (default mounts)
#   ./launch.sh --mounts my-project.conf     # custom mounts
#   ./launch.sh --autonomous "<prompt>"
#   ./launch.sh --resume                     # resume last conversation
#   ./launch.sh --build                      # rebuild image first
#   ./launch.sh --dry-run                    # print docker command only
#
# See mounts.conf.example for mount configuration format.

set -euo pipefail
. "$(dirname "$0")/config.sh"

# ── Defaults ────────────────────────────────────────────────────────
CONTAINER_NAME=""
MOUNTS_FILE=""
AUTONOMOUS=""
RESUME=false
EXTRA_PORTS=()
EXTRA_ENVS=()
DO_BUILD=false
DRY_RUN=false

# ── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)        CONTAINER_NAME="$2"; shift 2 ;;
    --mounts)      MOUNTS_FILE="$2"; shift 2 ;;
    --autonomous)  AUTONOMOUS="$2"; shift 2 ;;
    --resume)      RESUME=true; shift ;;
    --port)        EXTRA_PORTS+=("$2"); shift 2 ;;
    --env)         EXTRA_ENVS+=("$2"); shift 2 ;;
    --build)       DO_BUILD=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,/^$/{ s/^# //; s/^#//; p }' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Find mounts file ───────────────────────────────────────────────
if [[ -z "${MOUNTS_FILE}" ]]; then
  MOUNTS_FILE=$(resolve_mounts_file "") || {
    if [[ -f "${TOOLS_DIR}/mounts.conf.example" ]]; then
      MOUNTS_FILE="${TOOLS_DIR}/mounts.conf.example"
      echo "Note: Using mounts.conf.example (copy to mounts.conf to customize)"
    else
      echo "Error: No mounts.conf found. Copy mounts.conf.example and edit it."
      exit 1
    fi
  }
fi

# ── Resolve claude config dir from mounts file ─────────────────────
AGENT_CONFIG_DIR=$(parse_claude_config "${MOUNTS_FILE}") || exit 1

# ── Parse mounts ────────────────────────────────────────────────────
VOLUME_FLAGS=()
FIRST_RW_NAME=""
FIRST_RW_PATH=""
MCP_PATH_MAPPINGS=()

while IFS= read -r line; do
  # Strip comments and whitespace
  line="${line%%#*}"
  line="$(echo "${line}" | xargs)" # trim
  [[ -z "${line}" ]] && continue

  # Parse: <host-path> <mode> [<name>]
  read -r host_path mode name <<< "${line}"

  # Expand ~ to $HOME
  host_path="${host_path/#\~/${HOME}}"

  # Resolve to absolute path
  if [[ ! "${host_path}" = /* ]]; then
    host_path="$(cd "${host_path}" 2>/dev/null && pwd)" || {
      echo "Error: Cannot resolve path: ${host_path}"
      exit 1
    }
  fi

  # Default name to basename
  if [[ -z "${name}" ]]; then
    name="$(basename "${host_path}")"
  fi

  # Determine container path based on mode
  case "${mode}" in
    rw)
      container_path="${WORKSPACE_MOUNT}/${name}"
      docker_mode="rw"
      if [[ -z "${FIRST_RW_NAME}" ]]; then
        FIRST_RW_NAME="${name}"
        FIRST_RW_PATH="${container_path}"
      fi
      ;;
    ro)
      container_path="${REFERENCE_MOUNT}/${name}"
      docker_mode="ro"
      ;;
    mcp)
      container_path="${MCP_MOUNT}/${name}"
      docker_mode="ro"
      MCP_PATH_MAPPINGS+=("${host_path}|${container_path}")
      ;;
    claude)
      # Handled by parse_claude_config — skip here
      continue
      ;;
    *)
      echo "Error: Invalid mode '${mode}' for ${host_path}. Use 'rw', 'ro', 'mcp', or 'claude'."
      exit 1
      ;;
  esac

  VOLUME_FLAGS+=("-v" "${host_path}:${container_path}:${docker_mode}")
done < "${MOUNTS_FILE}"

if [[ -z "${FIRST_RW_NAME}" ]]; then
  echo "Error: No rw mount found in ${MOUNTS_FILE}. At least one is required."
  exit 1
fi

# ── Container name ──────────────────────────────────────────────────
if [[ -z "${CONTAINER_NAME}" ]]; then
  CONTAINER_NAME="${CONTAINER_PREFIX}-${FIRST_RW_NAME}"
fi

# ── Build if requested ──────────────────────────────────────────────
if [[ "${DO_BUILD}" == true ]]; then
  "${TOOLS_DIR}/build-image.sh"
fi

# ── Check for existing container ────────────────────────────────────
EXISTING_STATE=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
EXISTING_STATE="${EXISTING_STATE:-absent}"

case "${EXISTING_STATE}" in
  running)
    echo "Container ${CONTAINER_NAME} is running. Attaching..."
    if [[ "${DRY_RUN}" == true ]]; then
      echo "docker exec -it ${CONTAINER_NAME} zsh"
    else
      docker exec -it "${CONTAINER_NAME}" zsh
    fi
    exit 0
    ;;
  exited|created)
    echo "Container ${CONTAINER_NAME} exists (${EXISTING_STATE}). Resuming..."
    if [[ "${DRY_RUN}" == true ]]; then
      echo "docker start -ai ${CONTAINER_NAME}"
    else
      docker start -ai "${CONTAINER_NAME}"
    fi
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
  echo "Warning: No 'claude' entry in ${MOUNTS_FILE}."
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

# ── Write MCP path mappings ─────────────────────────────────────────
# The entrypoint reads this file and rewrites host paths in .claude.json
# so MCP server commands point to the container mount paths.
if [[ -n "${AGENT_CONFIG_DIR}" ]]; then
  MCP_MAP_FILE="${AGENT_CONFIG_DIR}/.mcp-path-map"
  if [[ ${#MCP_PATH_MAPPINGS[@]} -gt 0 ]]; then
    printf '%s\n' "${MCP_PATH_MAPPINGS[@]}" > "${MCP_MAP_FILE}"
    echo "MCP path mappings: ${#MCP_PATH_MAPPINGS[@]} server(s)"
  else
    rm -f "${MCP_MAP_FILE}"
  fi
fi

# ── Build docker run command ────────────────────────────────────────
CMD=(
  docker run
  --name "${CONTAINER_NAME}"
  -it
)

if [[ -n "${AGENT_CONFIG_DIR}" ]]; then
  CMD+=(-v "${AGENT_CONFIG_DIR}:${AGENT_HOME}/.claude:rw")
fi

CMD+=(
  "${VOLUME_FLAGS[@]}"
  -w "${FIRST_RW_PATH}"
  -p "${OAUTH_HOST_PORT}:${SLACK_OAUTH_PORT}"
)

# Extra ports
for port in "${EXTRA_PORTS[@]+"${EXTRA_PORTS[@]}"}"; do
  CMD+=(-p "${port}")
done

# Extra env vars
for env in "${EXTRA_ENVS[@]+"${EXTRA_ENVS[@]}"}"; do
  CMD+=(-e "${env}")
done

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
echo "Container: ${CONTAINER_NAME}"
echo "Working dir: ${FIRST_RW_PATH}"
if [[ -n "${AGENT_CONFIG_DIR}" ]]; then
  echo "Config: ${AGENT_CONFIG_DIR} → ${AGENT_HOME}/.claude"
else
  echo "Config: ephemeral (not persisted)"
fi
echo ""

if [[ "${DRY_RUN}" == true ]]; then
  echo "Dry run — would execute:"
  echo "  ${CMD[*]}"
else
  if [[ -z "${AUTONOMOUS}" ]]; then
    echo "Run inside container: claude --dangerously-skip-permissions"
    echo ""
  fi
  exec "${CMD[@]}"
fi
