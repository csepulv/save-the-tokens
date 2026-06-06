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

# tmux — required by Hermes's claude-code skill; openssh-server — SSH access;
# chromium + fonts — for agent-browser (below). On trixie, `chromium` self-resolves
# its runtime libs (the time64/`t64` variants), so no explicit lib list is needed —
# unlike the bookworm-based interactive image. (No tini: /init is the container's init now.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       tmux openssh-server \
       chromium fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# agent-browser (vercel-labs) — headless-browser CLI for in-container agent sessions.
RUN npm install -g @anthropic-ai/claude-code agent-browser

# Point agent-browser (and other CHROME_PATH-aware tools) at the apt Chromium.
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD stops Playwright fetching its own browser during
# project installs (Playwright itself does NOT read CHROME_PATH — projects pass
# executablePath or run `npx playwright install`). Mirrors the interactive image.
ENV CHROME_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

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
RUN env | grep -E '^(PATH=|HERMES_|CHROME_PATH=|PLAYWRIGHT_BROWSERS_PATH=|PYTHONUNBUFFERED=|npm_config_install_links=)' > /etc/environment \
 && sed 's/^/export /' /etc/environment > /etc/profile.d/hermes.sh

# Build-time sanity checks.
RUN claude --version && tmux -V && sshd -t && agent-browser --version && chromium --version
