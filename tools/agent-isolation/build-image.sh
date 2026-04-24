#!/usr/bin/env bash
# build-image.sh — Build the dark factory agent Docker image.
#
# Passes host UID/GID so bind-mount files have correct ownership.
# Usage: ./build-image.sh [--no-cache]

set -euo pipefail
. "$(dirname "$0")/config.sh"

EXTRA_FLAGS=""
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_FLAGS="--no-cache"
fi

echo "Building ${IMAGE_NAME}:latest (UID=$(id -u), GID=$(id -g))..."

docker build \
  --build-arg AGENT_UID="$(id -u)" \
  --build-arg AGENT_GID="$(id -g)" \
  --build-arg AGENT_USER="${AGENT_USER}" \
  ${EXTRA_FLAGS} \
  -t "${IMAGE_NAME}:latest" \
  "${TOOLS_DIR}"
