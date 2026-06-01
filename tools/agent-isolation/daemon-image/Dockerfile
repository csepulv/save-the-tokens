# Daemon (hermes-style) image — Hermes + Claude Code, with SSH, on the
# s6-overlay base.
#
# Built by `agent-isolation build daemon` as a date-tagged image
# (hermes-claude:yyyymmdd); referenced by the compose that `mode: daemon` emits.
#
# Modernized for the current nousresearch/hermes-agent base (s6-overlay v3).
# hermes' own Dockerfile overrode the ENTRYPOINT with a tini→entrypoint.sh
# wrapper; the new base's real ENTRYPOINT is `/init` (s6), which runs the
# container CMD as its main program ("Architecture B") AND runs the dashboard
# as an s6 service when HERMES_DASHBOARD is set. So we DON'T override the
# entrypoint — we just add tmux, Claude Code, and sshd (as an s6 cont-init
# hook, which runs as root at init).
#
# The base is PINNED BY DIGEST — `:latest` is a moving target (it silently
# rolled to s6-overlay v3 and broke the old approach). This digest is the s6
# base this image was built + proven against (pinned 2026-05-30). To adopt a
# newer base: update the digest deliberately, rebuild, re-prove, bump the
# DAEMON_IMAGE_TAG date in lib/constants.js.

FROM nousresearch/hermes-agent@sha256:80026fad0db5b444ff9f0f1413578becfcaad949d142c445fe26fc239cf24dc8

# Hermes runs from a venv at /opt/hermes/.venv; the base entrypoint activates
# it, but `docker exec` bypasses that — put it on PATH directly.
ENV PATH="/opt/hermes/.venv/bin:${PATH}"

# tmux — required by Hermes's claude-code skill; openssh-server — SSH access.
# (No tini: /init is the container's init now.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux openssh-server \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# bash as the hermes user's login shell (line editing/history over SSH); make
# the TUI build dir writable regardless of the runtime UID-remap.
RUN usermod -s /bin/bash hermes \
 && chmod -R 0777 /opt/hermes/ui-tui/dist

# sshd: drop-in config, host keys, the AuthorizedKeysFile dir, runtime dir.
COPY sshd-hermes.conf /etc/ssh/sshd_config.d/hermes.conf
RUN ssh-keygen -A && mkdir -p /etc/ssh/keys /run/sshd

# Start sshd at container init via an s6-overlay cont-init hook (runs as root,
# before the supervised services). Replaces hermes' entrypoint-wrapper approach.
COPY sshd-init.sh /etc/cont-init.d/01-sshd
RUN chmod +x /etc/cont-init.d/01-sshd

# ENV vars don't reach SSH sessions (sshd starts a fresh env). Propagate the
# functional ones via /etc/environment (non-login, PAM) and /etc/profile.d
# (login shells), so `hermes` is resolvable + finds its config over SSH.
RUN env | grep -E '^(PATH=|HERMES_|PLAYWRIGHT_BROWSERS_PATH=|PYTHONUNBUFFERED=|npm_config_install_links=)' > /etc/environment \
 && sed 's/^/export /' /etc/environment > /etc/profile.d/hermes.sh

# Build-time sanity checks.
RUN claude --version && tmux -V && sshd -t
