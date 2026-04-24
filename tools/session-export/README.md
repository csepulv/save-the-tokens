# session-export

Export Claude Code conversations from JSONL to readable markdown or plain text.

> **DISCLAIMER / PSA:** Shared as-is, I hope it helps. This space is
> evolving quickly. I am sharing to help others wade through the fog and
> swamp, as I have been doing. Look around; there are probably better
> tools than this one. 😉

## Why

Claude Code stores each session as a JSONL file under
`~/.claude/projects/<encoded-path>/<session-id>.jsonl`. Machine-friendly,
not reader-friendly — and the turns are interleaved with tool calls,
subagent traffic, thinking blocks, and system messages.

I wanted a way to get my conversations *out* — for archiving, sharing,
reviewing agent work, or feeding prior context back into a new session.
`session-export` reads the JSONL and emits markdown (with YAML
frontmatter and collapsible tool/thinking blocks) or plain text. It also
does bulk export organized by project, and emits aggregate per-session
stats as JSON.

Your mileage may vary — I share it in case it helps. There are other
tools in this space; look around before settling.

## Install

```bash
npm install -g @csepulv/session-export
```

(The CLI binary is still called `session-export` — only the npm
package name is scoped.)

Or from source:

```bash
git clone https://github.com/csepulv/save-the-tokens
cd save-the-tokens/tools/session-export
npm install
npm link  # makes `session-export` available globally
```

## Quick Start

```bash
# List conversations across all configured sources
session-export list

# Export a conversation to stdout (markdown, default format)
session-export 7dee69bc

# Export to a file, including tool calls
session-export --include-tools --output mysession.md 7dee69bc

# Bulk-export every conversation into per-project folders
session-export all ~/exports/archive/

# Aggregate per-session stats as JSON
session-export stats --after 2026-01-01 --before 2026-04-01 > stats.json
```

Run `session-export --help` or `session-export <command> --help` for
full flag details.

## Commands

| Command | Purpose |
|---|---|
| `session-export <id>` | Export one conversation (default — no subcommand word) |
| `session-export list` (alias `ls`) | List conversations |
| `session-export all <output-dir>` | Bulk export to per-project folders |
| `session-export stats` | Aggregate per-session stats as JSON |

All four commands accept `--source <alias\|path>` to restrict to one
configured source (or an ad-hoc directory). For `list`, `all`, and
`stats`, omitting `--source` walks **all** configured sources. For
`export`, `--source` defaults to `default`.

### Export one conversation

```bash
session-export [options] <id>
```

`<id>` matches first against the conversation's session ID (partial
match, e.g. `7dee69bc` → `7dee69bc-8dca-4383-a7d0-21e8446828c8`), then
against the conversation's custom title.

Examples:

```bash
# To stdout (markdown, default)
session-export 7dee69bc

# Plain text format
session-export --format text 7dee69bc

# Include tool calls (Read, Bash, Grep, etc.)
session-export --include-tools 7dee69bc

# Everything — tools, results, thinking, subagents, system, timestamps
session-export --include-all 7dee69bc

# From an alternate source
session-export --source work 7dee69bc
```

**Writing to a file:**

| Usage | Behavior |
|---|---|
| _(no --output)_ | Write to stdout |
| `--output mysession.md` | Write to `mysession.md` |
| `--output ~/exports/` | Write to `~/exports/<auto-slug>.md` |
| `--output` | Write to `<config.outputDir>/<auto-slug>.md` |

Auto-slug uses the conversation's custom title (slugified) or the
session ID.

**Content flags** (all default off):

| Flag | Adds |
|---|---|
| `--include-tools` | Assistant tool calls (Read, Bash, Grep, etc.) as collapsible blocks |
| `--include-system` | System messages (turn duration, subtype markers) |
| `--include-timestamps` | Per-message timestamps on role headers |
| `--include-skill-text` | Full skill body text (default: truncated to first 2 lines) |
| `--include-all` | All of the above, plus tool results, thinking blocks, and subagent conversations |

### List conversations

```bash
session-export list [options]
session-export ls [options]   # alias
```

Shows ID, date, project, and a preview line for each conversation.

```bash
# All sources (default)
session-export list

# One source
session-export list --source work

# Filter by project path substring
session-export list --filter my-app
```

### Bulk export

```bash
session-export all <output-dir> [options]
```

Writes one folder per project, two files per session — `<slug>.md`
(default export) and `<slug>.full.md` (same session with `--include-all`).
Sessions from different sources with the same project name merge into
one folder.

```bash
# Every conversation, every source
session-export all ~/exports/archive/

# Restrict to one source
session-export all ~/exports/archive/ --source work

# Filter by project path + date range
session-export all ~/exports/archive/ \
  --filter my-app \
  --after 2026-01-01 --before 2026-04-01
```

**Flags:**

| Flag | Purpose |
|---|---|
| `--source <alias\|path>` | Restrict to one source (default: walk all) |
| `--filter <substring>` | Filter by project path substring |
| `--after <date>` | Include sessions on or after (inclusive, start of day if date-only) |
| `--before <date>` | Include sessions on or before (inclusive, end of day if date-only) |
| `--config <path>` | Config file path (default: `~/.session-export.yaml`) |
| `--exclude-timestamps` | Omit per-message timestamps (default: included) |
| `--include-skill-text` | Keep full skill body text (default: truncated) |

Date format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS` (local time).

### Stats

```bash
session-export stats --after <date> --before <date> [options]
```

Emits a JSON object to stdout with aggregate per-session stats —
turn counts (user, assistant, subagent), token totals by model, start
and end timestamps, duration. No conversation content.

```bash
session-export stats --after 2026-03-01 --before 2026-03-31 > march.json
```

Exit codes:
- `0` — at least one session emitted
- `1` — error (bad args, I/O failure)
- `2` — no sessions in window (still emits valid JSON with `sessions: []`)

## Config

Optional config file at `~/.session-export.yaml`:

```yaml
# Default output directory for bare --output flag
outputDir: ~/exports

# Named source directories
sources:
  default: ~/.claude          # used when no --source given on the export command
  work: ~/.work-claude        # --source work
```

Without a config file: the `default` source is `~/.claude`, and bare
`--output` requires an explicit path.

## Output formats

### Markdown (default)

YAML frontmatter followed by the conversation. Turns separated by
horizontal rules with bold role labels. Assistant markdown (headings,
code blocks, tables) renders at its original heading levels.

```markdown
---
session: 7dee69bc-8dca-4383-a7d0-21e8446828c8
title: My Session
project: my-app
cwd: /path/to/my-app
hostname: my-host
git_branch: main
claude_version: 2.1.92
permission_mode: default
started_at: 2026-04-03T10:15:00.000Z
ended_at: 2026-04-03T11:42:00.000Z
duration: 1h 27m
---

# My Session

---

**User**

What does this script do?

---

**Assistant**

It exports Claude Code conversations…
```

With `--include-tools`, tool calls appear as collapsible `<details>`
blocks. With `--include-all`, tool results, thinking blocks, subagent
conversations, and system messages all render as collapsible sections.

### Plain text

`=== USER ===` / `=== ASSISTANT ===` headers with the same YAML
frontmatter. Use `--format text`.

## What gets filtered by default

Even without `--include-*` flags, the export includes only the
human/assistant dialogue. Infrastructure noise is filtered:

- Local command messages (`/exit`, `/color`, caveat notices) are excluded
- Tool calls and results are excluded unless `--include-tools` / `--include-all`
- System messages are excluded unless `--include-system` / `--include-all`
- Subagent conversations are included with `--include-all`

## Troubleshooting

### `session-export <id>` can't find the conversation

The `export` subcommand searches one source (the one `--source` resolves
to — `default` by default). If the conversation lives in a different
source, pass `--source <name>` or use `list` (which walks all sources)
to confirm where it is.

### `list` / `all` / `stats` show nothing

No configured source has a `projects/` subdirectory with matching JSONL
files. `session-export list` walks every source in your config; if you
get an empty table, either Claude Code hasn't recorded any sessions
there, or your config points at the wrong directory.

## Development

```bash
npm install
npm test           # vitest
npm run test:watch
```
