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
| `session-export get-id <slug>` | Resolve a `/rename`'d slug to its session UUID(s) |
| `session-export merge` | Sync session JSONLs from one Claude folder to another |
| `session-export copy` | Copy sessions between Claude folders (overwrites dest) |
| `session-export move` | Move sessions between Claude folders (dry-run by default) |
| `session-export remove` | Delete sessions by id/slug or `--project` pattern (dry-run by default) |
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

**Multiple matches:** if `<id>` matches more than one session
(substring of session id, or substring of custom title), the command
halts and lists every match — it does not silently pick one. Re-run
with a more specific id/title, or pass `--all` to emit every match.

> **Behavior change** (epic `merge`, 2026-04-26): earlier versions
> silently picked the first match on ambiguous input. The new halt is
> a small breaking change for scripts that fed an ambiguous slug and
> relied on getting *some* output. If that's you, either pass a fully-
> specific id/title or add `--all`.

```bash
# Halts and lists matches if 'shared-title' is ambiguous
session-export shared-title

# Emit every matching session (stdout: concatenated;
# --output dir/: one file per session with id-suffix in name)
session-export --all shared-title

# --all combined with --output <file> is refused (multiple sessions
# can't write to one file). Use --output dir/ instead.
```

**Content flags** (all default off):

| Flag | Adds |
|---|---|
| `--include-tools` | Assistant tool calls (Read, Bash, Grep, etc.) as collapsible blocks |
| `--include-system` | System messages (turn duration, subtype markers) |
| `--include-timestamps` | Per-message timestamps on role headers |
| `--include-skill-text` | Full skill body text (default: truncated to first 2 lines) |
| `--include-all` | All of the above, plus tool results, thinking blocks, and subagent conversations |

**Turn-filtering flags** (slice or narrow what gets emitted):

| Flag | Effect |
|---|---|
| `--user-only` | Emit only human-typed user prose. Drops assistant, system, subagents, and tool-result-only user records. Strips tool results from surviving user messages so `--include-all` can't smuggle them back in. |
| `--skip-turns N` | Skip the first N user/assistant turns. Default 0. |
| `--limit-turns N` | Emit at most N user/assistant turns. Default unlimited. |

A *turn* is one user or assistant message (counted after consecutive
assistant messages are merged). System and subagent messages do not
count as turns — they flow through transparently when they fall between
selected turns, and are dropped if before the first or after the last.
Frontmatter is always emitted, even when the body slice is empty.

```bash
# Just the prompts you sent — no model output
session-export --user-only 7dee69bc

# First three turns only
session-export --limit-turns 3 7dee69bc

# Skip the first ten turns, take the next five
session-export --skip-turns 10 --limit-turns 5 7dee69bc

# Only your prose, in turns 2-4
session-export --user-only --skip-turns 1 --limit-turns 3 7dee69bc
```

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

# Restrict by mtime window (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
session-export list --after 2026-06-01
session-export list --after 2026-06-02T08:00:00 --before 2026-06-02T18:00:00

# Machine-readable output (full ISO timestamps, no truncation)
session-export list --format json
```

The default `table` format truncates the date to the minute and clips
columns for display. `--format json` emits an array of
`{ sessionId, date, project, encodedDir, preview }` (plus `source` when
walking all sources) with the full ISO `date` (the JSONL's mtime). Use it
when a consumer needs to parse the list reliably — e.g. the `junkdrawer`
CLI compares each `date` against its last-synced timestamp to decide what
needs re-syncing without exporting every session.

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
| `--user-only` | Emit only human-typed user prose; skip the redundant `.full.md` |
| `--skip-turns N` | Skip the first N user/assistant turns in each session |
| `--limit-turns N` | Emit at most N user/assistant turns per session |

Date format: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS` (local time).

When `--user-only` is set, only `<slug>.md` is written per session — the
`.full.md` would be identical (assistant content is gone) so it's
skipped. `--skip-turns` and `--limit-turns` apply to both files when
`--user-only` is not set.

### Resolve a slug to a session id

```bash
session-export get-id <slug> [--source <alias|path>]
```

`<slug>` is the custom title set via Claude Code's `/rename`. The
match is exact — substring matches don't count. By default, every
configured source is searched.

Output is one tab-separated line per match:
`<sessionId>\t<source>\t<project>`. Exits non-zero if there are no
matches; exits zero (and lists every match) when one or more match.
The caller disambiguates.

```bash
session-export get-id nesso-memory
# 09eeea4d-e949-46ef-906b-e79ec5af0ad4	default	workspace/nesso

# Restrict to one source
session-export get-id nesso-memory --source ~/Downloads/doppio-claude
```

### Merge sessions between Claude folders

```bash
session-export merge [id] --source <alias|path> [--dest <alias|path>] \
  [--project <name> | --all] [--force | --skip-newer]
```

One-way, file-level sync of session JSONL files from one Claude
folder into another. Useful when you continued a conversation on
another machine and want to land it back on your primary one.

| Arg | Purpose |
|---|---|
| `[id]` (positional) | Session slug or full UUID — limits to that one session |
| `--source <alias\|path>` | Where sessions come from (required) |
| `--dest <alias\|path>` | Where they go (default: `default`) |
| `--project <pattern>` | Limit to one project — exact display name, or anchored glob if it contains `*` |
| `--all` | Merge every session in source |
| `--force` | Overwrite even when dest mtime is newer |
| `--skip-newer` | Skip files where dest mtime is newer; copy the rest |

Exactly one scope is required: positional `[id]`, or `--project`, or `--all`.

**Conflict pre-flight:** before any file is written, `merge`
classifies each source file against its dest counterpart by `mtime`.
If any dest file is newer than its source, the command halts and
prints the conflict list — nothing is copied. Re-run with `--force`
to overwrite, or `--skip-newer` to copy the rest and leave conflicts
alone.

```bash
# Merge a single session by slug into the default Claude folder
session-export merge nesso-memory --source ~/Downloads/doppio-claude

# Merge by full UUID
session-export merge 7e9b370d-e628-4c4a-8b86-ebe2ff2d9c6b \
  --source ~/Downloads/doppio-claude

# Merge every session from an external folder, overwriting on conflict
session-export merge --source ~/Downloads/old-claude --all --force

# Limit to one project, skip-newer semantics for safety
session-export merge \
  --source ~/Downloads/old-claude \
  --project workspace/myapp \
  --skip-newer
```

This is a one-way merge — sessions in `--dest` that aren't in
`--source` are left alone. The merge is at the file level only;
divergent JSONL transcripts cannot be reconciled at the line level.

### Copy and move sessions between Claude folders

```bash
session-export copy [id] --source <alias|path> [--dest <alias|path>] [--project <pattern>]
session-export move [id] --source <alias|path> [--dest <alias|path>] [--project <pattern>] [--yes]
```

`copy` and `move` relocate session JSONL files between Claude folders
with plain `cp` / `mv` semantics — pick a scope, name a destination,
done. `copy` leaves the source intact; `move` deletes it afterward.

| Arg | Purpose |
|---|---|
| `[id]` (positional) | Exact session UUID **or** exact custom-title slug — no substring match |
| `--source <alias\|path>` | Where sessions come from (required) |
| `--dest <alias\|path>` | Where they go (default: `default`) |
| `--project <pattern>` | Project display name. Exact match unless the pattern contains `*` |
| `--yes` | (`move` only) Execute the move. Without it, `move` is a dry-run |

Exactly one of `[id]` or `--project` is required. Scope and pattern
semantics are identical to [`remove`](#remove-sessions) — exact id/slug,
anchored-glob `--project` against the decoded display name.

**`copy` vs `merge`.** `merge` is a conflict-aware sync — it compares
`mtime`, skips files already current in the dest, and halts on
conflicts. `copy` is unconditional: it overwrites whatever is in the
dest, no questions asked. Reach for `merge` when reconciling two
folders that both have history; reach for `copy` when you just want
these sessions over there. Both preserve the source mtime, so the
copy keeps its place in `list` and `stats`.

**`move` is dry-run by default.** Without `--yes`, `move` lists every
session that would move — annotating any that would overwrite an
existing dest file — and changes nothing. With `--yes` it copies all
files first, then deletes the sources, then removes any source project
directory left empty (same cleanup rule as `remove` — a `subagents/`
dir with content blocks it). Copy-before-delete means a failure
partway through leaves the source intact and the command re-runnable.

```bash
# Copy one session into the default Claude folder
session-export copy nesso-memory --source ~/Downloads/doppio-claude

# Copy a whole project between two folders
session-export copy --project workspace/myapp \
  --source ~/Downloads/old-claude --dest work

# Preview a move (dry-run — nothing changes)
session-export move 7e9b370d-e628-4c4a-8b86-ebe2ff2d9c6b \
  --source ~/Downloads/doppio-claude

# Execute the move after reviewing the dry-run
session-export move 7e9b370d-e628-4c4a-8b86-ebe2ff2d9c6b \
  --source ~/Downloads/doppio-claude --yes
```

### Remove sessions

```bash
session-export remove [id] [--project <pattern>] [--source <alias|path>] [--yes]
```

Delete session JSONL files. Cleans up the encoded project directory if it
ends up empty. **Dry-run by default** — without `--yes`, the command lists
every session that would be deleted (one per line: source, sessionId,
project, full path) and a summary count. Files are untouched until you
re-run with `--yes`.

| Arg | Purpose |
|---|---|
| `[id]` (positional) | Exact session UUID **or** exact custom-title slug — no substring match |
| `--project <pattern>` | Project display name. Exact match unless the pattern contains `*` |
| `--source <alias\|path>` | Restrict to one source (default: walk every configured source) |
| `--yes` | Execute the deletion. Without this, it's a dry-run |

Exactly one of `[id]` or `--project` is required.

**`<id>` semantics.** Same as `merge`: full UUID filename or exact custom
title. Substrings are rejected. Slug ambiguity within one source halts
non-zero. With the default walk-all-sources scope, an id matching in
multiple sources also halts — re-run with `--source` to disambiguate.

**`--project` semantics.** Without `*`, the value must match the decoded
display name **exactly**. With `*`, the pattern is an anchored glob (matches
the whole name from start to end) — `*` is the only metacharacter; every
other character (including `?`, `.`, `(`, etc.) is treated literally.

**Patterns match the *decoded* display name.** Claude Code stores projects
under encoded dirnames where `-` separates path segments
(`-Users-you-workspace-myapp`); decoding restores `/` boundaries
(`workspace/myapp` after the home prefix is stripped). Patterns are matched
against the decoded form. Run `session-export list --filter <substring>`
first to see what your project names actually look like before constructing
a pattern.

```bash
# Recon: scan project names with a substring filter (cheap, read-only)
session-export list --filter monitor

# Dry-run: show what would be deleted, change nothing
session-export remove --project '*claude-monitor*'

# Execute after reviewing the dry-run output
session-export remove --project '*claude-monitor*' --yes

# Exact-match (no wildcards)
session-export remove --project 'workspace/scratch/claude-monitor' --yes

# Path-anchored: match a whole subtree
session-export remove --project '/private/tmp/*' --yes

# Single session by UUID
session-export remove 7dee69bc-8dca-4383-a7d0-21e8446828c8 --yes

# Single session by slug (exact custom title)
session-export remove nesso-memory --yes
```

**Glob caveats.**

- Anchored: `claude-monitor-*` matches names *starting with* `claude-monitor-`.
  To match anywhere, write `*claude-monitor*`. To match a path subtree,
  prefix with the segment(s) you mean — e.g., `workspace/*` not just `*`.
- `*` does cross `/` boundaries. `/private/*` matches
  `/private/tmp/claude/monitor/verify`.
- Other characters are literal. `claude.monitor` does not match
  `claude/monitor` — the `.` is a literal dot, not a wildcard.

**Cleanup.** After `--yes` deletes the JSONLs, the encoded project directory
is removed when nothing significant remains. A `subagents/` subdirectory
with content blocks cleanup (so agent traces survive); an empty
`subagents/` does not.

**Multiple sources.** Without `--source`, the command walks every source
in your config — same default as `list`, `stats`, and `all`. With
`--source`, the scope shrinks to that one.

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

`AskUserQuestion` exchanges are an exception — they always render in
default mode, since the answer is the user's input, not tool traffic.
Each question appears under the assistant turn as `**Q (<header>):**`,
and the picked answer appears under the user turn as `**A (<header>):**`.
With `--include-all`, the full options list renders under each question
with the picked option bolded, and the user's answer line is prefixed
with `✓`. Free-text answers (when the user picks "Other") render as
`Other — "<text>"`.

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
- `AskUserQuestion` Q&A is always included — questions on the assistant
  side, answers on the user side. `--include-all` adds the full options
  list and a `✓` mark on the picked answer.

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
