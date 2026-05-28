#!/usr/bin/env bash
# services.sh — Service-container orchestration for agent-isolation.
#
# Sourced (not executed) by launch.sh:  . "$(dirname "$0")/services.sh"
#
# Provides:
#   resolve_services_file     — validate the services compose file path
#                                (read from the agent config's services:)
#   compose_external_network  — extract the (single) external network name
#   services_project_name     — stable docker-compose -p name from filename
#   ensure_network            — create the user-defined bridge if missing
#   ensure_services_up        — bring services up; wait for healthy
#   teardown_services         — docker compose down (keeps named volumes)
#   post_session              — interactive post-session teardown / reminder
#   agent_on_network          — is a container attached to a given network

# Validate a services compose file path.
# Echoes the resolved path. Empty input → empty output (services opt-out).
# Errors if a path is given but does not exist.
resolve_services_file() {
  local path="${1:-}"
  [[ -z "${path}" ]] && return 0
  path="${path/#\~/${HOME}}"
  if [[ ! -f "${path}" ]]; then
    echo "Error: Services file not found: ${path}" >&2
    return 1
  fi
  echo "${path}"
}

# Extract the (single) external network name declared in a compose file.
# This is the network the agent joins — same one the services attach to.
# Errors if zero or more than one external network is declared.
compose_external_network() {
  local file="$1"
  local nets
  nets=$(docker compose -f "$file" config --format json 2>/dev/null \
    | jq -r '.networks // {} | to_entries
              | map(select(.value.external == true))
              | .[].key')
  if [[ -z "${nets}" ]]; then
    echo "Error: ${file} declares no external network." >&2
    echo "  Add a 'networks:' block with one entry marked 'external: true'." >&2
    return 1
  fi
  local count
  count=$(printf '%s\n' "${nets}" | wc -l | xargs)
  if [[ "${count}" != "1" ]]; then
    echo "Error: ${file} declares ${count} external networks; expected exactly 1." >&2
    echo "  Found: $(echo "${nets}" | tr '\n' ' ')" >&2
    return 1
  fi
  echo "${nets}"
}

# Derive a stable Compose project name from a services file basename, so
# per-project compose files co-located in one directory do not collide.
#   jd.services.compose.yml  →  agent-svc-jd
#   services.compose.yml     →  agent-svc-services
services_project_name() {
  local base
  base="$(basename "$1")"
  base="${base%.services.compose.yml}"
  base="${base%.compose.yml}"
  base="${base%.yml}"
  base="${base%.yaml}"
  echo "agent-svc-${base}"
}

# Create a user-defined bridge network if it does not already exist.
ensure_network() {
  local network="$1"
  if ! docker network inspect "${network}" &>/dev/null; then
    docker network create "${network}" >/dev/null
    echo "Created network: ${network}"
  fi
}

# Bring service containers up on the agent network and wait until healthy.
ensure_services_up() {
  local services_file="$1"
  local network="$2"
  local project
  project="$(services_project_name "${services_file}")"

  ensure_network "${network}"
  echo "Starting services: ${services_file} (project ${project})"
  docker compose -p "${project}" -f "${services_file}" up -d --wait
  echo "Services ready."
}

# Stop service containers. Named volumes are preserved (plain `down`).
teardown_services() {
  local services_file="$1"
  local project
  project="$(services_project_name "${services_file}")"
  echo "Stopping services: ${services_file}"
  docker compose -p "${project}" -f "${services_file}" down
}

# Is container $1 attached to docker network $2?
agent_on_network() {
  local name="$1"
  local network="$2"
  docker inspect --format \
    '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
    "${name}" 2>/dev/null | grep -qw "${network}"
}

# Run after an agent session ends. Decides whether to tear down services.
#   $1 services_file   — set in Mode A (launch.sh started the services)
#   $2 network         — the network the agent joined
#   $3 agent_running   — "true" if the agent container is still running
#   $4 autonomous      — "true" for headless (--autonomous) runs
post_session() {
  local services_file="$1"
  local network="$2"
  local agent_running="$3"
  local autonomous="$4"

  # Mode B — joined an existing network; launch.sh did not start services.
  if [[ -z "${services_file}" ]]; then
    [[ -n "${network}" ]] && \
      echo "" && \
      echo "Services on network '${network}' left running and unchanged."
    return 0
  fi

  # Attach path — the agent container is still running; services in use.
  if [[ "${agent_running}" == "true" ]]; then
    echo ""
    echo "Agent container still running; services left untouched."
    return 0
  fi

  local stop_hint="Stop them with: docker compose -p $(services_project_name "${services_file}") -f ${services_file} down"

  # Autonomous — no human at the terminal; never block on a prompt.
  if [[ "${autonomous}" == "true" ]]; then
    echo ""
    echo "Services left running. ${stop_hint}"
    return 0
  fi

  # Interactive — prompt. Bare Enter defaults to teardown.
  echo ""
  local answer=""
  read -r -p "Stop the services started this session? [Y/n] " answer || true
  if [[ -z "${answer}" || "${answer}" =~ ^[Yy] ]]; then
    teardown_services "${services_file}"
  else
    echo "Services left running. ${stop_hint}"
  fi
}
