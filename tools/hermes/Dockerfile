# Hermes + Claude Code container, with SSH.
#
# Extends the official Hermes Agent image with tmux, the Claude Code CLI, and
# an SSH server so the Hermes TUI can be driven over a real PTY.
#
# Build once, share across every container:  docker build -t hermes-claude .

FROM nousresearch/hermes-agent:latest

# Hermes runs from a venv at /opt/hermes/.venv; the base entrypoint activates
# it, but `docker exec` bypasses the entrypoint — put it on PATH directly.
ENV PATH="/opt/hermes/.venv/bin:${PATH}"

# tmux — required by Hermes's claude-code skill; openssh-server — SSH access.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux openssh-server \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Runtime ergonomics:
#  - bash as the hermes user's login shell — the default /bin/sh (dash) has no
#    line editing or history, which makes interactive SSH unpleasant.
#  - `hermes --tui` rebuilds the TUI into /opt/hermes/ui-tui/dist on launch, but
#    /opt/hermes stays owned by the build UID after the runtime UID-remap — so
#    make that build dir writable regardless of the runtime UID.
RUN usermod -s /bin/bash hermes \
 && chmod -R 0777 /opt/hermes/ui-tui/dist

# sshd: drop-in config, host keys, the AuthorizedKeysFile dir, runtime dir.
COPY sshd-hermes.conf /etc/ssh/sshd_config.d/hermes.conf
RUN ssh-keygen -A && mkdir -p /etc/ssh/keys /run/sshd

# Wrapper entrypoint: starts sshd as root, then hands off to the base entrypoint.
COPY hermes-entrypoint.sh /usr/local/bin/hermes-entrypoint.sh
RUN chmod +x /usr/local/bin/hermes-entrypoint.sh
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/hermes-entrypoint.sh"]

# The image's ENV vars (PATH, HERMES_HOME, …) do not reach SSH sessions — sshd
# starts a fresh environment. Without HERMES_HOME, `hermes` can't find its
# config; without PATH, `hermes` isn't even resolvable. Propagate the
# functional ENV vars, in both forms:
#   /etc/environment    — non-login sessions (`ssh host <cmd>`), read via PAM.
#   /etc/profile.d/*.sh — login shells; sourced by /etc/profile AFTER it resets
#                         PATH, so the values survive.
RUN env | grep -E '^(PATH=|HERMES_|PLAYWRIGHT_BROWSERS_PATH=|PYTHONUNBUFFERED=|npm_config_install_links=)' > /etc/environment \
 && sed 's/^/export /' /etc/environment > /etc/profile.d/hermes.sh

# Build-time sanity checks.
RUN claude --version && tmux -V && sshd -t
