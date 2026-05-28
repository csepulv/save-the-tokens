# Save The Tokens

Tools and skills for working with AI coding agents — especially
[Claude Code](https://docs.claude.com/en/docs/claude-code).

**Writing:** [savethetokens.dev](https://savethetokens.dev)

---

## Tools

Standalone utilities. Each has its own README with full install and
usage.

| Tool | What it does |
| ---- | ------------ |
| [`agent-sync`](tools/agent-sync/) | Manage AI assistant skills, plugins, MCP servers, and rules across Claude, Codex, and Gemini. |
| [`session-export`](tools/session-export/) | Export Claude Code conversations from JSONL to readable markdown or plain text. |
| [`sekko`](tools/sekko/) | Capture browser and terminal sessions; extract structured artifacts AI agents can read. |
| [`agent-isolation`](tools/agent-isolation/) | Run Claude Code in isolated Docker containers with full access to your skills, plugins, and MCP config. |

### Install from npm

```bash
npm install -g @csepulv/agent-sync       # agent-sync CLI
npm install -g sekko                     # sekko CLI (macOS arm64 only)
npm install -g @csepulv/session-export   # session-export CLI
```

`agent-isolation` ships as a Dockerfile + scripts — clone the repo
and follow its [README](tools/agent-isolation/).

> Coming from `ai-config-sync`? It was renamed to `@csepulv/agent-sync`.
> See [the migration steps](tools/agent-sync/#coming-from-ai-config-sync).

## Skills

Claude Code skills — drop-in `~/.claude/skills/<name>/` to make them
invocable from any project.

| Skill | What it does |
| ----- | ------------ |
| [`visual-rosetta`](skills/visual-rosetta/) | Map a page's visual regions to its DOM, and compare a reference against an implementation. |
| [`visual-qa`](skills/visual-qa/) | Browser-based directed and exploratory testing of a running site. |
| [`skill-advisor`](skills/skill-advisor/) | Recommends relevant skills for a task — never auto-invokes. |
| [`file-index`](skills/file-index/) | Generate and reuse a file index so agents navigate unfamiliar code fast. |
| [`sekko`](skills/sekko/) | Drive the `sekko` CLI — record, extract, and read browser/terminal sessions to debug, build tests, or learn a UI or CLI. |

## Status

Early and evolving. Names, interfaces, and organization may change.
No versioning guarantees yet.

## License

MIT — see [LICENSE](LICENSE).
