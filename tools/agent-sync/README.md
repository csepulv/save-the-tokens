# agent-sync

CLI tool for managing AI assistant skills, plugins, MCP servers, and rules across Claude, Codex, and Gemini.

> **DISCLAIMER / PSA:** Shared as-is, I hope it helps. This space is
> evolving quickly. I am sharing to help others wade through the fog and
> swamp, as I have been doing. Look around; there are probably better
> tools than this one. 😉

## Why

I was manually juggling skill sources — my working repo copy vs
`~/.claude/skills/` — and losing track of which was the source of
truth. Then I added another machine, and it got worse. Then other
AI coding tools (Codex, Gemini) — each with their own config.

So I built `agent-sync` one weekend with Claude Code, and have been
iterating on it since. It lets you:

- Keep skills, rules, and MCP servers in one (or more) source
  directories — e.g., `~/ai-config/personal`, `~/ai-config/team`
- Merge them with a defined priority order
- Sync out to every tool you use — Claude Code (including multiple
  instances), Claude Desktop, Codex, Cursor, Gemini

Your mileage may vary — I share it in case it helps. There are other
tools in this space; look around before settling.

## Features

- **Fetch skills** from GitHub repositories
- **Sync skills** to Claude, Codex, and Gemini config directories
- **Manage plugins** for Claude Code
- **Sync MCP servers** across Claude Code, Claude Desktop, Cursor, and Gemini
- **Sync rules** to configured targets
- **Generate skill catalogs** for skill-advisor
- **Interactive mode** with status checks and guided fixes

## Installation

```bash
npm install -g agent-sync

# OR

npx agent-sync readme
npx agent-sync init
```

Or from source:

```bash
git clone https://github.com/csepulv/save-the-tokens
cd save-the-tokens/tools/agent-sync
npm install
npm link  # Makes `agent-sync` available globally
```

## Quick Start

```bash
# First-time setup — creates ~/.agent-sync with defaults
agent-sync init

# Edit ~/.agent-sync to set your source-directories and config-directory
# (see Configuration below)

# Fetch any GitHub-sourced skills declared in skills-directory.yaml
agent-sync fetch

# Sync skills, rules, and MCP to all configured targets
agent-sync sync

# Or use interactive mode — checks status and offers fixes
agent-sync
```

## Commands

| Command | Description |
|---------|-------------|
| `agent-sync` | Interactive mode (default) |
| `agent-sync readme` | Show this README |
| `agent-sync init` | Initialize configuration |
| `agent-sync check` | Check status (CI-friendly) |
| `agent-sync fetch [name]` | Fetch skills from GitHub |
| `agent-sync add <url> [--sourceIndex N]` | Add a new skill from GitHub |
| `agent-sync sync [target]` | Sync skills to targets |
| `agent-sync plugins` | Sync Claude plugins |
| `agent-sync mcp` | Sync MCP servers to targets |
| `agent-sync rules` | Sync rules to targets |
| `agent-sync catalog` (alias: `cat`) | Regenerate skill catalog |
| `agent-sync zip [name]` | Zip skills for Claude Desktop upload |
| `agent-sync migrate-config` | Migrate config to latest format version |

### Global Options

```bash
--config, -c           Override config directory path
--check-public-updates Check for skill updates from GitHub (makes API calls)
--help, -h             Show help
--version, -v          Show version
```

By default, the tool does **not** check GitHub for skill updates — this avoids making an API call per skill on every run. Pass `--check-public-updates` when you want to see if newer versions of your fetched skills are available.

## Configuration

### ~/.agent-sync

The tool stores its configuration at `~/.agent-sync`:

```yaml
version: 2

# Source directories (read-only, contain skill/plugin definitions)
# Listed in priority order - first source wins on conflicts
source-directories:
  - ~/ai-config/personal             # Your personal skills (priority 1)
  - ~/ai-config/team                 # Team shared skills (priority 2)

# Config directory (where merged/fetched skills are stored)
config-directory: ~/ai-config/merged

# Override default target paths (optional)
# claude-code is an array (supports multiple instances); other targets are objects
targets:
  claude-code:
    - mcp: true                      # Default instance (~/.claude)
  codex:
    skills: ~/.codex/skills
    rules: ~/.codex
  gemini:
    skills: ~/.gemini/skills
    rules: ~/.gemini
    mcp: true
```

### Multi-Source Architecture

The tool supports multiple source directories. For example, you might want to use both personal and team configurations:

1. **Source directories** contain `skills-directory.yaml`, `plugins-directory.yaml`, `mcp-directory.yaml`, and custom `skills/`
2. **Config directory** is where fetched GitHub skills and merged custom skills are stored
3. **Targets** are where skills, MCP servers, and rules get synced

```
Flow: source-directories → merge → config-directory/skills → sync to targets
```

See **[How It Works](#how-it-works)** for the step-by-step pipeline.

### Directory Structure

```
# Source directory (e.g., ~/ai-config/personal/)
├── skills/                      # Custom skill files
│   └── my-custom-skill/
│       └── SKILL.md
├── skills-directory.yaml        # Skill definitions
├── plugins-directory.yaml       # Plugin definitions
└── mcp-directory.yaml           # MCP server definitions

# Config directory (e.g., ~/ai-config/merged/)
└── skills/                      # Fetched + copied skills
    ├── my-custom-skill/         # Copied from source
    ├── fetched-skill/           # Fetched from GitHub
    └── skill-advisor/
        └── references/
            └── skill-catalog.md # Auto-generated catalog
```

### skills-directory.yaml

```yaml
skills:
  # Custom skill (managed locally)
  - name: my-skill
    source: custom
    category: primary
    disable-model-invocation: false
    last_fetched: null
    sync_hash: null

  # Skill from GitHub
  - name: mcp-builder
    source: https://github.com/anthropics/skills/tree/main/skills/mcp-builder
    category: contextual
    disable-model-invocation: true
    last_fetched: "2025-01-15T00:00:00.000Z"
    sync_hash: a3f8c2d1e9b047...
```

`sync_hash` is an MD5 hash of the skill's `SKILL.md` content, written after each sync. It replaces the older `last_sync` timestamp — hash comparison is deterministic across machines, so pulling this file via git and running on another machine won't trigger spurious re-syncs.

### plugins-directory.yaml

Plugins are a Claude Code feature (marketplaces + `claude plugin install`);
agent-sync wraps those CLI calls to keep your installed plugin set in sync
with this file. Other targets (Codex, Cursor, Gemini) don't have an
equivalent plugin system and are skipped by the `plugins` command.

```yaml
# Marketplaces are auto-registered before plugins are installed.
# The source field accepts GitHub owner/repo shorthand or full URLs.
marketplaces:
  - name: claude-plugins-official
    source: anthropics/claude-plugins-official

  - name: claude-code-workflows
    source: wshobson/agents

plugins:
  - name: context7
    marketplace: claude-plugins-official
    category: core

  - name: code-review
    marketplace: claude-plugins-official
    category: core

  - name: typescript-lsp
    marketplace: claude-plugins-official
    category: lsp

  - name: accessibility-compliance
    marketplace: claude-code-workflows
    category: workflows
```

### mcp-directory.yaml

```yaml
servers:
  # stdio server - runs a local command
  - name: context7
    command: npx
    args: ["-y", "@upstash/context7-mcp@latest"]

  # stdio server with environment variables
  - name: github-mcp
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "$GITHUB_TOKEN"

  # HTTP server
  - name: remote-api
    type: http
    url: "https://api.example.com/mcp"
    headers:
      Authorization: "Bearer ${MCP_AUTH_TOKEN}"
```

String values support `$VAR` / `${VAR}` expansion and `~/` home directory expansion. Variables resolve from `mcp-vars` in `~/.agent-sync` first, then environment variables.

```yaml
# In ~/.agent-sync
mcp-vars:
  GITHUB_TOKEN: "ghp_your_token_here"
  MCP_AUTH_TOKEN: "sk-proj-abc123"
```

### MCP Targets

MCP servers sync to the targets enabled in `~/.agent-sync`. Default target is `claude-code`.

| Target | Method | Config Location |
|--------|--------|-----------------|
| `claude-code` | CLI (`claude mcp add-json`) | `~/.claude.json` |
| `claude-desktop` | File merge | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| `cursor` | File merge | `~/.cursor/mcp.json` |
| `gemini` | File merge | `~/.gemini/settings.json` |

### Multi-Instance Claude Code

You can run multiple Claude Code installations (e.g., personal and work) by using the `CLAUDE_CONFIG_DIR` environment variable. agent-sync supports syncing skills, rules, and MCP servers to each instance independently.

**Requires config v2.** Run `agent-sync migrate-config` to upgrade from v1.

In v2 format, the `claude-code` target is always an array:

```yaml
version: 2
targets:
  claude-code:
    - mcp: true                          # "default" instance, uses ~/.claude
    - name: work
      config-dir: ~/.claude-work
      mcp: true
```

Each entry supports these fields:

| Field | Default | Description |
|---|---|---|
| `name` | `"default"` | Instance identifier (used in state, CLI output, `--target` filtering) |
| `config-dir` | `~/.claude` | Claude config directory |
| `mcp` | `false` | Whether to sync MCP servers to this instance |
| `skills` | `<config-dir>/skills` | Override skills path |
| `rules` | `<config-dir>/rules` | Override rules path |

All instances share the same rules sources (`rules/claude-code/` in source directories). State is tracked independently per instance (e.g., `claude-code` and `claude-code:work` in state files).

For MCP sync, non-default instances use `CLAUDE_CONFIG_DIR=<config-dir>` when calling the Claude CLI.

**Caveats:**
- `CLAUDE_CONFIG_DIR` is not officially documented by Anthropic. Behavior may change. See GitHub issues [#25762](https://github.com/anthropics/claude-code/issues/25762) and [#28808](https://github.com/anthropics/claude-code/issues/28808).
- The VS Code extension's `/ide` command does not work with custom config directories (it hardcodes `~/.claude/ide/`).
- Claude Code still creates local `.claude/` directories in workspaces for `settings.local.json`, regardless of `CLAUDE_CONFIG_DIR`.

### Config Version Migration

Configs without a `version` field are v1 (the original format). To upgrade:

```bash
agent-sync migrate-config
```

This wraps `targets.claude-code` in an array and adds `version: 2`. All other fields are preserved. The v1 format continues to work for single-instance setups.

## Usage Examples

### Add a skill from GitHub

```bash
# Add to first source directory (default)
agent-sync add https://github.com/anthropics/skills/tree/main/skills/frontend-design

# Add to a specific source directory (0-based index)
agent-sync add https://github.com/.../skills/team-skill --sourceIndex 1

agent-sync sync
```

### Update all skills from sources

```bash
agent-sync fetch
agent-sync fetch --force     # Re-fetch all, ignoring timestamps
agent-sync catalog
agent-sync sync
```

### Sync to specific target

```bash
agent-sync sync claude
agent-sync sync claude,codex
```

### Clean orphaned skills from targets

```bash
agent-sync sync --clean
agent-sync sync --force      # Force re-sync to all targets
```

### Package a skill for Claude Desktop

Claude Desktop installs skills via a zip upload through its Skills UI.
`agent-sync zip` packages custom skills in the structure that upload
flow expects.

```bash
agent-sync zip                    # zip all custom skills
agent-sync zip skill-advisor      # zip one specific skill
agent-sync zip --output ./dist    # write to a custom output directory
```

Upload the resulting `.zip` through Claude Desktop's skill-upload UI.
See the [Claude Desktop skills guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
for the current upload path.

### Install missing plugins

```bash
agent-sync plugins
agent-sync plugins --dry-run  # Preview only
agent-sync plugins --clean    # Also uninstall unlisted
```

### Sync MCP servers

```bash
agent-sync mcp               # Sync servers to all targets
agent-sync mcp --dry-run     # Preview changes
agent-sync mcp --clean       # Also remove servers no longer in directory
agent-sync mcp --replace     # Replace all servers with changed configs
agent-sync mcp --force       # Force re-sync all (clears state, implies --replace)
```

### Sync rules

```bash
agent-sync rules
agent-sync rules --dry-run
agent-sync rules --clean
agent-sync rules --force     # Force re-sync all (clears state, rewrites all files)
```

## How It Works

1. **Source directories** contain `skills-directory.yaml` with skill definitions and `skills/` with custom skills
2. **Merge** combines skills from all sources (first wins on conflicts)
3. **Fetch** downloads GitHub skills to `config-directory/skills/`
4. **Copy** copies custom skills from source directories to `config-directory/skills/`
5. **Catalog** generates a skill catalog at `config-directory/skills/skill-advisor/references/`
6. **Sync** copies skills to targets (`~/.claude/skills`, etc.) and injects `disable-model-invocation` settings

## MCP Server Management

The `mcp` command syncs servers defined in `mcp-directory.yaml` to all enabled targets. It tracks state in `mcp-state.json` to know which servers it previously placed.

### Adding servers

Define servers in `mcp-directory.yaml` in any source directory, then run `agent-sync mcp`. Servers are merged from all sources (first source wins on name conflicts).

### Removing servers

Remove the server from `mcp-directory.yaml` and run `agent-sync mcp --clean`. The tool compares the directory against its state file and removes servers that are no longer listed.

In interactive mode, the tool detects servers to remove and offers a per-server checkbox (unchecked by default) so you can choose which to actually remove.

### Replacing servers

When a server's config changes (e.g., new args or env), the CLI target (`claude-code`) skips it by default to avoid overwriting local changes. Use `--replace` to replace all, or run interactively to get a per-server replace checkbox.

### Unmanaged servers

The tool detects servers installed at targets that aren't in any `mcp-directory.yaml`. In interactive mode, it offers two choices per server:

1. **Import** - adds the server to `mcp-directory.yaml` so it becomes managed (env values are extracted to `mcp-vars`)
2. **Remove** - deletes the server from all targets

Servers that are neither imported nor removed will be detected again on the next run.

### State tracking

The tool writes `mcp-state.json` to the config directory after each sync. This tracks which servers were synced to each target, enabling:
- Detection of servers to remove (in state but not in directory)
- Distinguishing intentional removals from unmanaged servers (previously-managed servers aren't offered for re-import)

## Skill Categories

- **primary** - Core skills, typically auto-invocable
- **contextual** - Context-specific skills, typically require `/skill-name`
- **experimental** - Testing/development skills

## disable-model-invocation

When `disable-model-invocation: true` is set in skills-directory.yaml:
- The setting is injected into SKILL.md frontmatter during sync
- Prevents the AI from auto-invoking the skill
- User must explicitly invoke with `/skill-name`

## Samples

The `samples/` directory contains example configurations:

- `agent-sync.v2.example.yaml` - Example v2 config with multi-instance Claude Code
- `skills-directory.example.yaml` - Example skill registry
- `plugins-directory.example.yaml` - Example plugin registry
- `mcp-directory.example.yaml` - Example MCP server registry
- `skill-advisor/` - A "gatekeeper" skill that recommends other skills

### skill-advisor

The skill-advisor implements a gatekeeper pattern:

1. It's set with `disable-model-invocation: false` so it auto-activates
2. It reads `references/skill-catalog.md` (auto-generated by `agent-sync catalog`)
3. It recommends relevant skills but doesn't auto-invoke them
4. Users explicitly choose which skill to use

To use it:
1. Copy `samples/skill-advisor/` to your source directory's `skills/` folder
2. Add to your source's `skills-directory.yaml`:
   ```yaml
   - name: skill-advisor
     source: custom
     category: primary
     disable-model-invocation: false
   ```
3. Run `agent-sync fetch` to copy custom skills to config-directory
4. Run `agent-sync catalog` to generate the skill catalog
5. Run `agent-sync sync`

## Requirements

### Required

- **Node.js >= 18**

### Recommended

- **[GitHub CLI (`gh`)](https://cli.github.com/)** — Used for authenticated GitHub API access when fetching skills. Without it, the tool falls back to unauthenticated requests, which are limited to 60 requests/hour and may fail on private repos. Install and run `gh auth login` to authenticate.

### Optional (feature-dependent)

- **[Claude Code CLI (`claude`)](https://docs.anthropic.com/en/docs/claude-code)** — Required for plugin management (`plugins` command) and MCP server sync to the `claude-code` target. Not needed if you only sync skills, rules, or MCP servers to file-based targets (Claude Desktop, Cursor, Gemini).

## Troubleshooting

### GitHub rate limit hit while fetching skills

Without `gh` authenticated, unauthenticated requests are capped at 60/hour.
Install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`.

### A skill didn't sync

Run `agent-sync check` (non-interactive) to see detailed status. Common
causes:
- Skill name missing from `skills-directory.yaml` in any source directory
- Custom skill (`source: custom`) folder missing under `<source>/skills/<name>/`
- Target config directory permissions

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run CLI locally
node agent-sync.js --help
```

## License

MIT
