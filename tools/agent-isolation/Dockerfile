# Claude Code Agent — isolated Docker container
#
# Build:  ./build-image.sh
# Run:    ./launch.sh

FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# ── System dependencies ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libxss1 \
    libxtst6 \
    jq \
    curl \
    vim-tiny \
    procps \
    rsync \
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Playwright/Puppeteer: use system Chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROME_PATH=/usr/bin/chromium

# ── Claude Code + powerline ──────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code @owloops/claude-powerline

# ── Non-root user ────────────────────────────────────────────────────
# UID/GID passed as build args to match host user for bind-mount ownership.
ARG AGENT_UID=501
ARG AGENT_GID=20
ARG AGENT_USER=agent

RUN groupadd -g ${AGENT_GID} ${AGENT_USER} 2>/dev/null || true && \
    useradd -m -u ${AGENT_UID} -g ${AGENT_GID} -s /bin/zsh ${AGENT_USER}

# ── Entrypoint ───────────────────────────────────────────────────────
# Handles .claude.json symlink, git config, config mount verification.
# No config files baked in — all config comes from volume mounts.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER ${AGENT_USER}
WORKDIR /workspace

# Slack MCP OAuth callback
EXPOSE 3118

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["zsh"]
