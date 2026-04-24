# agent-isolation

Run Claude Code in isolated Docker containers with full access to your skills, plugins, rules, and MCP servers.

> **DISCLAIMER / PSA:** Shared as-is, I hope it helps. This space is
> evolving quickly. I am sharing to help others wade through the fog and
> swamp, as I have been doing. Look around; there are probably better
> tools than this one. 😉

## Why

Claude Code offers [permission modes](https://code.claude.com/docs/en/permission-modes)
that trade safety for autonomy — `acceptEdits` and `--dangerously-skip-permissions`
are useful for unattended or exploratory runs, but the blast radius is your
whole machine. This tool runs Claude Code inside a Docker container so that
permissive modes have a minimal blast radius: the container, not your host.
Your `~/.claude/` config, MCP servers, and target project are mounted in;
everything outside those mounts is invisible to the agent.

## Prerequisites

- macOS (tested on Apple Silicon; may work elsewhere with tweaks)
- Docker Desktop
- `jq` (`brew install jq`)

## Quick Start

```bash
cd save-the-tokens/tools/agent-isolation

# 1. Copy and edit mounts config
cp mounts.conf.example mounts.conf
# Edit mounts.conf — set your claude config path and target project

# 2. Sync your .claude config (run once, or after config changes)
./sync-config.sh
./sync-config.sh --force    # re-sync

# 3. Build the agent image (run once, or after Dockerfile changes)
./build-image.sh

# 4. Launch interactive container
./launch.sh
# Prompt changes to agent@<id>:/workspace/<project>$
claude --dangerously-skip-permissions
```

## Scripts

| Script           | Purpose                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `config.sh`      | Shared constants (sourced by all scripts)                                                      |
| `sync-config.sh` | Sync `~/.claude/` → claude config dir (from mounts.conf) with path rewriting and MCP injection |
| `build-image.sh` | Build the Docker image with correct UID/GID                                                    |
| `launch.sh`      | Create, resume, or attach to agent containers                                                  |

## Mount Configuration

Edit `mounts.conf` to declare what gets mounted. Format:

```
# <host-path>  <mode>  [<name>]
~/agent-workspace/agent-claude  claude
/path/to/my-project             rw
/path/to/shared-lib             ro
/path/to/design-docs            ro  docs
/path/to/handoff                mcp
```

**Convention:**

- `claude` mount → `~/.claude` inside the container (read-write, synced config — at most one)
- `rw` mounts → `/workspace/<name>` (read-write)
- `ro` mounts → `/reference/<name>` (read-only)
- `mcp` mounts → `/mcp/<name>` (read-only, host paths rewritten in Claude config)
- First `rw` entry becomes the container's working directory
- `name` is optional — defaults to the directory's basename

**The `claude` mount is optional but recommended.** The host path can be any
empty directory — `sync-config.sh` creates and populates it. Having this mount
means your Claude config (skills, plugins, MCP, sessions) persists across
container recreations, so you can stop a container, recreate it, and resume
the same session. Without a `claude` entry, the container uses an ephemeral
`~/.claude` that's lost when the container is removed.

**MCP mounts:** For local MCP servers configured with absolute host paths. The `mcp` mode
mounts the source into the container and rewrites the paths in `.claude.json` so Claude Code can find them at
`/mcp/<name>/...` instead of their host paths.

## Sync Config Options

```
./sync-config.sh [OPTIONS]

  --mounts FILE       Mounts config file (default: mounts.conf)
  --source DIR        Source claude config dir (default: ~/.claude)
  --force             Overwrite existing synced config
  --headless          Strip statusLine from settings (for autonomous runs)
  --include-all       Include projects/sessions/cache/backups (default: excluded)
```

## Launch Options

```
./launch.sh [OPTIONS]

  --name NAME         Container name (default: agent-<project>)
  --mounts FILE       Mounts config file (default: mounts.conf)
  --autonomous "TEXT" Run claude headless with the given prompt
  --resume            Resume the last conversation
  --port HOST:CTNR    Publish additional port (repeatable)
  --env KEY=VAL       Set environment variable (repeatable)
  --build             Rebuild image before launching
  --dry-run           Print docker command without executing
```

## Session Persistence

Containers are named `agent-<project>` (e.g., `agent-my-project`). Running `launch.sh` again with the same name:

- **If running** → attaches to the existing session
- **If stopped** → resumes the container
- **If absent** → creates a new container

If a `claude` entry is in your mounts.conf, all Claude Code state (`~/.claude/`) persists at that host path. You can:

- Stop and resume the same container
- Delete the container and create a new one (config persists)
- Copy the claude config directory to another machine to continue there

Closing the terminal stops the container (it's attached to the TTY). For
long-running sessions you want to disconnect from, wrap `launch.sh` in
`tmux` or `screen`.

## First-Run Notes

### Slack MCP OAuth

First time Claude uses Slack tools, it prints an OAuth URL. Open it in your host browser. The callback hits
`localhost:3118`, which is forwarded to the container.

### Claude Login

Your `.credentials.json` is synced from the host. If the token expires, Claude will prompt `/login` — it prints a URL,
open it on the host.

## Container Details

- **Base:** `node:20-bookworm` (Debian, ARM64)
- **User:** `agent` (UID matches host user)
- **Includes:** Node.js 20, Claude Code, claude-powerline, git, Chromium, jq
- **Git identity:** `claude-agent <agent@localhost>` (override via `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`)
- **Port 3118:** Always published (Slack OAuth callback)

## Cleanup

```bash
# Stop a container
docker stop agent-my-project

# Remove a container (config persists on host)
docker rm agent-my-project

# Remove all stopped agent- containers
docker ps -a --filter "name=agent-" -q | xargs docker rm

# Remove the image
docker rmi claude-agent

# Remove synced config (path from your mounts.conf claude entry)
rm -rf ~/agent-workspace/agent-claude/
```

## File Layout

```
agent-isolation/
├── config.sh               # Shared constants
├── Dockerfile              # Agent image
├── entrypoint.sh           # Container runtime setup
├── sync-config.sh          # Config sync with transforms
├── build-image.sh          # Docker build wrapper
├── launch.sh               # Container lifecycle
├── mounts.conf.example     # Mount config template
└── README.md               # This file

~/agent-workspace/
└── agent-claude/           # Persistent .claude (path from mounts.conf claude entry)
    ├── .credentials.json   # OAuth token (synced from host)
    ├── CLAUDE.md           # Global instructions
    ├── settings.json       # Container-tailored settings
    ├── rules/              # Coding standards
    ├── skills/             # All skills
    ├── plugins/            # Plugin cache + marketplace data
    ├── projects/           # Written by Claude Code
    ├── sessions/           # Written by Claude Code
    └── backups/            # .claude.json backups
```
