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

# 1. Copy and edit the per-container config
cp agent.yml.example my-project.agent.yml
# Edit my-project.agent.yml — mounts (incl. a claude entry), hostname,
# ports, services/network, env, on_start. See agent.yml.example for the
# full schema.

# 2. Sync your .claude config into the agent-claude bind-mount target
./sync-config.sh --config my-project.agent.yml
./sync-config.sh --config my-project.agent.yml --force    # re-sync

# 3. Build the agent image (run once, or after Dockerfile changes)
./build-image.sh

# 4. Launch interactive container
./launch.sh --config my-project.agent.yml
# Prompt changes to agent@<hostname>:/workspace/<project>$
claude --dangerously-skip-permissions
```

If only one `*.agent.yml` exists in cwd (or in the tool dir), `--config`
auto-detects it; the flag becomes optional.

## Node CLI

The host-side orchestration is also available as a single `agent-isolation`
Node CLI — the going-forward implementation. The subcommands mirror the
shell scripts one-for-one, read the same `agent.yml`, and produce the same
result (the sync output and `docker run` command are verified equal to the
shell scripts' against a differential test):

```bash
npm install                                  # once

node bin/agent-isolation.js sync   --config my-project.agent.yml
node bin/agent-isolation.js build
node bin/agent-isolation.js launch --config my-project.agent.yml
node bin/agent-isolation.js launch --config my-project.agent.yml --dry-run
```

`sync` accepts `--source`, `--force`, `--headless`, `--include-all`;
`launch` accepts `--name`, `--autonomous "<prompt>"`, `--resume`, `--build`,
`--dry-run`; `build` accepts `--no-cache`. Run any subcommand with `--help`.

**Daemon mode (experimental).** A config with `mode: daemon` makes `launch`
*emit* a `docker-compose.yml` for an always-on, hermes-style container (gateway
+ dashboard + ssh) instead of running an interactive `docker run` — see
`agent.daemon.yml.example`. Build the image with `agent-isolation build daemon`
— it produces a **date-tagged** `hermes-claude:<yyyymmdd>` (e.g.
`hermes-claude:20260530`) on the s6-overlay Hermes base, which is **pinned by
digest** in the daemon Dockerfile so rebuilds are reproducible. Then `docker
compose -f <workspace>/docker-compose.yml up -d`. Verified to stand up (ssh +
dashboard). Default mode is `interactive` (everything above).

**Per-container tools (daemon mode).** To add tools to *one* container without
baking them into the default image, give the daemon config a `build:` block
(`dockerfile` + optional `context`/`args`). The emitted compose then carries a
`build:` section instead of the base `image:`, and you run `docker compose ...
up -d --build`. The Dockerfile must start `FROM hermes-claude:<yyyymmdd>` and add
your tools — use it for things that can't be mounted from the host (a
Linux-native binary, an arch-specific build); mountable, pure-JS tools should
just be mounted. See the `build:` stanza in `agent.daemon.yml.example`.

The Node CLI needs Node 20+, Docker, and `rsync` (it does the JSON
transforms natively — `jq`/`yq` are only needed by the shell scripts).
The container layer (`Dockerfile`, `entrypoint.sh`) is unchanged and still
shell. The shell scripts below remain for now; they are superseded by the
Node CLI for host-side work.

## Scripts

| Script           | Purpose                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `config.sh`      | Shared constants (sourced by all scripts)                                                      |
| `services.sh`    | Service-container orchestration helpers (sourced by `launch.sh`)                               |
| `sync-config.sh` | Sync `~/.claude/` → claude config dir (driven by `agent.yml`): compose container settings.json from template + selected host fields, write the in-container `rules/local-additional-context.md`, rewrite host paths to container paths, inject MCP servers, warn about unmapped host paths |
| `migrate-mounts.sh` | One-time helper: convert an old `mounts.conf` to a new `agent.yml`. |
| `build-image.sh` | Build the Docker image with correct UID/GID                                                    |
| `launch.sh`      | Create, resume, or attach to agent containers                                                  |

## Configuration

One YAML file per container: `<name>.agent.yml`. Holds mounts, hostname,
ports, services-or-network, env, optional on_start. Full schema lives in
[`agent.yml.example`](./agent.yml.example).

```yaml
# Identity (both optional; defaults derived from the filename:
#   tsugi.agent.yml → container_name agent-tsugi, hostname agent-tsugi)
container_name: agent-tsugi
hostname: tsugi-dev

# Mounts. Modes: claude / rw / ro / mcp. `target` defaults to basename.
mounts:
  - { host: ~/agent-workspace/agent-claude, mode: claude }
  - { host: ~/workspace/tsugi,              mode: rw }
  - { host: ~/workspace/stt-private,        mode: ro }
  - { host: ~/some-mcp-source,              mode: mcp, target: my-mcp }

# Ports (list). Number → host == container; "host:cntr" string → explicit.
ports:
  - 5173
  - "27017:27017"

# Services compose file (Mode A) OR existing network to join (Mode B).
services: tsugi.services.compose.yml
# network: junkdrawer_default

# Env vars passed into the container.
env:
  PROJECT_API_HOST: http://elasticsearch:9200
```

### Mount modes

- `claude` → `/home/agent/.claude` inside the container (≤1; persistent
  synced config).
- `rw` → `/workspace/<target>` (read-write; first rw becomes container CWD).
- `ro` → `/reference/<target>` (read-only).
- `mcp` → `/mcp/<target>` (read-only; host paths rewritten in
  `.claude.json` at sync time).

**The `claude` mount is optional but recommended.** The host path can be
any empty directory — `sync-config.sh` creates and populates it. Without
it, the container uses an ephemeral `~/.claude` that's lost when the
container is removed.

### Migrating from `mounts.conf`

Old `mounts.conf` files convert with the helper:

```bash
./migrate-mounts.sh junkdrawer.mounts.conf
# → writes junkdrawer.agent.yml AND prints to stdout
```

The output filename is derived from the input (`X.mounts.conf` →
`X.agent.yml`). Flags:

- `--stdout` — print only, don't write a file.
- `-f` / `--force` — overwrite an existing `<name>.agent.yml`.
- Reading from stdin (`./migrate-mounts.sh < x.mounts.conf`) is
  stdout-only — there's no input filename to derive an output name from.

The script translates mount lines + the `hostname` keyword. Add ports,
services, env, on_start by hand afterward.

### `on_start` — auto-run a command at every container start

Add an `on_start` block to the agent config to run a backgrounded
command inside the container at every start (fresh create AND resume).
Shape:

```yaml
on_start:
  command: <shell command string — runs under bash -c>
  env:                                  # optional
    KEY: value
  log: /tmp/agent-on-start.log          # optional; default shown
```

Output is captured to the `log` path; errors are not surfaced through
the agent's terminal. Tail the log to confirm the command ran.

Worked example (claude-monitor's local-daemon, given the relevant `ro`
mount of `tools/claude-monitor`):

```yaml
on_start:
  command: node /reference/stt-private/tools/claude-monitor/packages/local-daemon/src/index.js
  env:
    CENTRAL_URL: http://host.docker.internal:4830
  log: /tmp/local-daemon.log
```

`on_start` is generic — agent-isolation has no claude-monitor-specific
code, the daemon recipe is just the first user. The file is refreshed
by `launch.sh` on every launch, so edits to the YAML take effect at
the next `launch.sh` invocation without `docker rm`.

**Where the runtime state lives.** `launch.sh` writes
`~/.agent-isolation/state/<container-name>/on-start.json` on the host
and bind-mounts that dir read-only at `/home/agent/.agent-isolation/`
inside the container. The entrypoint reads from there. This dir is
*outside* the persistent `agent-claude/` config dir so agent-isolation
runtime artifacts don't accumulate in claude's state.

## Service Containers

An isolated agent often needs a backing service — MongoDB, Elasticsearch,
and the like. Those run as separate containers, and the agent reaches them
over a shared docker network. There are two ways to wire this up.

### Mode A — let agent-isolation start the services

Declare the services in a Compose file and reference it from your agent
config's `services:` key. `launch.sh` reads the external network name
from the Compose file, creates that network if it does not exist, brings
the services up (waiting until they report healthy), and joins the agent
to the same network.

```bash
# 1. Copy the template, keep the services you need, delete the rest
cp services.compose.yml.example my-project.services.compose.yml

# 2. In my-project.agent.yml, set:
#      services: my-project.services.compose.yml

# 3. Launch — services start automatically
./launch.sh --config my-project.agent.yml
# (or omit --config if only one *.agent.yml is in cwd)
```

Service files are per-project: each Compose file declares exactly the
services that project needs.

### Mode B — services already running

If the services are already up on a docker network (for example, started
by another project's own `docker compose`), set `network:` in your
`agent.yml` instead of `services:`:

```yaml
# my-project.agent.yml
network: junkdrawer_default
```

`services` and `network` are mutually exclusive — `services` already
knows the network from the compose file.

### Running multiple agents concurrently

The network name lives in the compose file's `networks:` block (declared
`external: true`). For one project at a time, the shipped `agent-net`
default is fine. To run two or more agent stacks at once without service
collisions, give each project's compose file a distinct network name:

```yaml
# jd.services.compose.yml
networks:
  jd-net:
    external: true
```

```yaml
# other.services.compose.yml
networks:
  other-net:
    external: true
```

Each project's services live on their own network. Each agent only sees
its own services. Service-name DNS (`elasticsearch`, `mongodb`, …) stays
unambiguous even if both projects declare the same service names. The
compose project name (`-p agent-svc-jd`, `-p agent-svc-other`) is
already derived from the filename, so containers and volumes are also
distinct.

### Reaching services from the agent

The agent reaches each service by its **service name** on the network —
**not `localhost`**. For the template's services:

| Service       | URL from inside the agent   |
| ------------- | --------------------------- |
| Elasticsearch | `http://elasticsearch:9200` |
| MongoDB       | `mongodb://mongodb:27017`   |

Point your project's service URLs at these names (via an env var the
project reads). A project hardcoded to `localhost` will not find them.

Service ports are **not** published to the host by default — the agent
does not need them. Uncomment the `ports:` blocks in the Compose file
only if you also want host access (Compass, Kibana, a host-side `curl`).

### Stopping services

Services start detached, so they keep running after the agent container
exits — named volumes mean the next launch resumes instantly. When an
agent session ends and `launch.sh` started the services, it prompts:

```
Stop the services started this session? [Y/n]
```

Enter (or `Y`) runs `docker compose down` — containers stop, named
volumes (your data) are kept. `n` leaves them running and prints the
command to stop them later. Headless (`--autonomous`) runs skip the
prompt and leave services running.

## Sync Config Options

```
./sync-config.sh [OPTIONS]

  --config FILE       Agent config file (auto-detects a single *.agent.yml
                      in cwd or the tool dir if omitted).
  --source DIR        Source claude config dir (default: ~/.claude).
  --force             Overwrite existing synced config.
  --headless          Strip statusLine from settings (for autonomous runs).
  --include-all       Include projects/sessions/cache/backups (default: excluded).
```

## Launch Options

```
./launch.sh [OPTIONS]

  --config FILE       Agent config file (auto-detects a single *.agent.yml
                      in cwd or the tool dir if omitted).
  --name NAME         Override the container name. Default precedence:
                      config's `container_name` → derived from filename
                      (e.g. tsugi.agent.yml → agent-tsugi).
  --autonomous "TEXT" Run claude headless with the given prompt.
  --resume            Resume the last conversation.
  --build             Rebuild image before launching.
  --dry-run           Print docker command without executing.
```

Ports, env vars, services, network, hostname all live in the YAML config
— not flags. Edit the config file rather than passing them per-launch.

## Session Persistence

Containers are named `agent-<project>` (e.g., `agent-my-project`). Running `launch.sh` again with the same name:

- **If running** → attaches to the existing session
- **If stopped** → resumes the container
- **If absent** → creates a new container

If your `agent.yml` has a `claude` mount, all Claude Code state (`~/.claude/`) persists at that host path. You can:

- Stop and resume the same container
- Delete the container and create a new one (config persists)
- Copy the claude config directory to another machine to continue there

Closing the terminal stops the container (it's attached to the TTY). For
long-running sessions you want to disconnect from, wrap `launch.sh` in
`tmux` or `screen`.

## Multi-Shell Workflow

A second `./launch.sh --config <same>.agent.yml` invocation while the
container is already running **attaches to it** via `docker exec` — no
new container created. This separates "long-lived services running in
the container" from "claude session against the container":

```bash
# Terminal 1 — launch the container, start backgrounded servers:
./launch.sh --config my-project.agent.yml
# Inside the container shell:
nohup pnpm dev > /tmp/web.log 2>&1 & disown

# Terminal 2 — same host, separate terminal:
./launch.sh --config my-project.agent.yml
# Attaches via `docker exec` to the running container.
claude --dangerously-skip-permissions
```

When you `/exit` claude in terminal 2, the servers in terminal 1 keep
running. Useful for "I want to leave the dev server up while I exit the
agent shell to inspect things from the host."

Important: long-running processes started from *inside* a claude session
should be **detached** (`nohup … > /tmp/log 2>&1 & disown`) — otherwise
their stdout/stderr bleeds into the TUI and makes the session unusable.

## In-Container Agent Context

When `sync-config.sh` runs, it writes
`<agent-claude>/rules/local-additional-context.md` from the shipped
`tools/agent-isolation/local-additional-context.md.example` (or your
personal `local-additional-context.md` if you've created one in the
tool dir — gitignored). The file holds environment facts the
in-container agent needs: mount layout, service-name DNS,
port-forwarding-create-time, baked-in tools, multi-shell pattern.

To load it automatically, add one line to your **host**
`~/.claude/CLAUDE.md`:

```
@~/.claude/rules/local-additional-context.md
```

The same import line resolves to your host's version on the host
(your personal local stance — host-only rules, etc.) and to the
container's version inside the container (the environment facts).
Same path, location-specific content. Claude Code silently ignores
missing `@`-imports, so the host doesn't need to pre-create the file
if you don't have host-local stance to add.

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

# Stop service containers for a project (keeps named volumes / data)
docker compose -p agent-svc-<project> -f my-project.services.compose.yml down

# ...and delete their data volumes too
docker compose -p agent-svc-<project> -f my-project.services.compose.yml down -v

# Remove the agent network (once nothing is attached to it).
# The name is the one declared in your services.compose.yml.
docker network rm agent-net   # or whatever your compose file named it

# Remove the image
docker rmi claude-agent

# Remove synced config (path from your agent.yml claude mount)
rm -rf ~/agent-workspace/agent-claude/

# Remove the per-container runtime state dir (on_start config, etc.)
rm -rf ~/.agent-isolation/state/agent-my-project
```

The compose project name is `agent-svc-<basename>` of the services file —
e.g. `my-project.services.compose.yml` → `agent-svc-my-project`.

## File Layout

```
agent-isolation/
├── config.sh                    # Shared constants
├── services.sh                  # Service orchestration helpers (sourced)
├── Dockerfile                   # Agent image
├── entrypoint.sh                # Container runtime setup
├── sync-config.sh               # Config sync with transforms
├── build-image.sh               # Docker build wrapper
├── launch.sh                    # Container lifecycle
├── agent.yml.example            # Per-container config template
├── migrate-mounts.sh            # Converts old mounts.conf → agent.yml
├── services.compose.yml.example # Service containers template
├── settings.container.json.example # Container-stance settings.json template
├── local-additional-context.md.example # In-container agent context (env facts)
└── README.md                    # This file

~/agent-workspace/
└── agent-claude/           # Persistent .claude (path from agent.yml claude mount)
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
