# hermes-container

Build per-container [Hermes Agent](https://github.com/NousResearch/hermes-agent) + Claude Code deployments from a single YAML config. Hermes orchestrates (cron, skills, Curator, dashboard); Claude Code runs as a worker tool inside. One config file per container — run as many as you like, side by side.

`init-hermes-container <config.yaml>` reads the config, seeds the container's Claude Code config from your `~/.claude`, and generates a `docker-compose.yml` inside the config's `hermes_workspace`.

## Prerequisites

- Docker Desktop
- Node.js 20+
- `rsync` (preinstalled on macOS) — used to seed the Claude Code config
- An Anthropic API key (or another LLM provider key Hermes supports)

## One-time: build the image

All containers share one image. From this directory:

```bash
docker build -t hermes-claude .
```

Rebuild only when the `Dockerfile` changes. (Rebuilding rotates the container's SSH host keys — `ssh` will warn about a changed host key; clear it with `ssh-keygen -R "[host]:port"`.)

Install the CLI (optional — otherwise call it with `node`):

```bash
npm install        # first time, for js-yaml + get-port
npm link           # makes `init-hermes-container` global
```

## Per container

### 1. Write a config

```bash
cp hermes.config.yaml.example ~/my-hermes.config.yaml
$EDITOR ~/my-hermes.config.yaml
```

Key fields (see the example file for the full annotated schema):

- `container_name` — names the containers + the compose project
- `hermes_workspace` — a folder that holds this container's state (`<ws>/hermes`, `<ws>/claude-code`) and its generated `docker-compose.yml`
- `ports` — optional; omitted ports auto-assign to the next free one
- `ssh` — SSH access (on by default; password or key auth)
- `env` — LLM provider keys, messaging tokens
- `mounts` — workspaces (`rw`) and references (`ro`)

The config holds secrets — **keep it out of git.**

### 2. Generate the deployment

```bash
init-hermes-container ~/my-hermes.config.yaml
# or:  node init-hermes-container.js ~/my-hermes.config.yaml
```

This creates `<hermes_workspace>/hermes` and `<hermes_workspace>/claude-code`, seeds the Claude config (one-time copy of `~/.claude`, with `mcpServers` stripped), and writes `<hermes_workspace>/docker-compose.yml`. Re-running is safe — it regenerates the compose and skips the seed if the config dir is already populated.

### 3. Bring it up

```bash
docker compose -f <hermes_workspace>/docker-compose.yml up -d
docker compose -f <hermes_workspace>/docker-compose.yml exec -it gateway hermes setup   # first-run wizard
docker compose -f <hermes_workspace>/docker-compose.yml restart
```

- Dashboard: `http://localhost:<dashboard-port>`
- Gateway API: `http://localhost:<gateway-port>` (both bound to `127.0.0.1`)

## SSH access

SSH lets you drive the Hermes TUI over a real PTY (resize, colours, clipboard) — far better than `docker exec`. It is enabled by default; the SSH port is reachable from your LAN.

```bash
ssh hermes@localhost -p <ssh-port>
```

Auth is the `hermes` user with the password from `ssh.password`. Public-key auth is preferred — set it up as below.

### Installing an SSH key

1. **Have a key pair.** Use an existing `~/.ssh/id_ed25519` (+ `.pub`), or create one: `ssh-keygen -t ed25519 -C "hermes container"`.

2. **Point the config at the *public* key** — the `.pub` file; the private key stays on your host:

   ```yaml
   ssh:
     enabled: true
     password: still-here-as-a-fallback
     authorized_key: ~/.ssh/id_ed25519.pub
   ```

3. **Regenerate and recreate the container** — a new mount is a config change, so `up -d` (recreate), not `restart`:

   ```bash
   init-hermes-container ~/your.config.yaml
   docker compose -f <hermes_workspace>/docker-compose.yml up -d
   ```

   No need to redo `hermes setup` — the wizard's config lives in the `/opt/data` mount (`<hermes_workspace>/hermes/`), which survives container recreation.

4. **Connect with the key:**

   ```bash
   ssh -i ~/.ssh/id_ed25519 hermes@localhost -p <ssh-port>
   ```

The tool bind-mounts the `.pub` file to `/etc/ssh/keys/hermes` in the container (sshd reads it via `AuthorizedKeysFile`) — nothing is copied into the image, no rebuild. Rotate a key by changing the config path and re-running steps 3–4. `authorized_key` is a single file path, but that file may hold several public keys, one per line, if you want more than one.

**A `~/.ssh/config` shortcut** — drops you straight into the TUI in a persistent tmux session:

```
Host hermes
  HostName localhost
  Port <ssh-port>
  User hermes
  RequestTTY yes
  RemoteCommand tmux new -A -s hermes hermes
```

Then `ssh hermes` from cold to chatting. If your connection drops, the TUI keeps running in tmux — reconnect and you are back. To disable SSH for a container, set `ssh: { enabled: false }`.

## Multiple containers

One config file per container — give each a distinct `container_name` and `hermes_workspace`. Port auto-assignment only sees ports already bound **when the tool runs**, so generate *and start* each container before generating the next:

```bash
init-hermes-container ~/a.config.yaml && docker compose -f <a-workspace>/docker-compose.yml up -d
init-hermes-container ~/b.config.yaml && docker compose -f <b-workspace>/docker-compose.yml up -d
```

Or set explicit, non-overlapping `ports` in each config — then order doesn't matter.

## Operations

```bash
WS=<hermes_workspace>
docker compose -f $WS/docker-compose.yml up -d        # start (also applies regenerated config)
docker compose -f $WS/docker-compose.yml stop          # pause (keeps containers)
docker compose -f $WS/docker-compose.yml down          # stop + remove containers (state survives)
docker compose -f $WS/docker-compose.yml logs -f       # tail logs
docker compose -f $WS/docker-compose.yml exec -it gateway hermes   # CLI inside the container
docker compose -f $WS/docker-compose.yml exec gateway hermes doctor
```

State lives in the bind mounts under `hermes_workspace` — `stop`/`down` never touch it. To start over, remove `<ws>/hermes` and `<ws>/claude-code` and re-run `init-hermes-container`.

### Moving a workspace

The generated `docker-compose.yml` bakes in **absolute host paths** for every bind mount. If you move `hermes_workspace` (or it goes missing) while a container exists, the next `docker compose up` — including the automatic restart after a host reboot — finds the mount sources gone and **Docker silently recreates them as empty directories**. Hermes then boots a blank, unconfigured state while your real config sits orphaned at the old path.

To relocate a workspace safely:

```bash
docker compose -f <old-ws>/docker-compose.yml down   # stop first
mv <old-ws> <new-ws>                                 # move the workspace
$EDITOR <config.yaml>                                # point hermes_workspace at <new-ws>
init-hermes-container <config.yaml>                  # regenerate compose with new paths
docker compose -f <new-ws>/docker-compose.yml up -d
```

The same applies to any mount whose host path you change — treat a moved path as a config change: regenerate, then `up -d`.

## Tests

```bash
npm test     # vitest
```

## More

- `hermes.config.yaml.example` — the full annotated config schema
- Design, decisions, milestones: `stt-private/docs/hermes/`
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) · [Hermes docs](https://hermes-agent.nousresearch.com/docs/user-guide/)
