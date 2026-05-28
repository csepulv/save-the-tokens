#!/usr/bin/env bash
# Wrapper entrypoint. Runs as root (the container starts as root): start sshd,
# then hand off to the Hermes base entrypoint, which drops privileges to the
# hermes user. sshd must start before that drop because it needs root.
set -e

if [ "${SSH_ENABLED:-true}" = "true" ]; then
  mkdir -p /run/sshd
  ssh-keygen -A >/dev/null 2>&1 || true
  if [ -n "${SSH_PASSWORD:-}" ]; then
    echo "hermes:${SSH_PASSWORD}" | chpasswd
  fi
  /usr/sbin/sshd
  echo "hermes-entrypoint: sshd started"
fi

exec /opt/hermes/docker/entrypoint.sh "$@"
