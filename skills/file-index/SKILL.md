---
name: file-index
description: Use when exploring unfamiliar codebases, searching for code, or when user requests to generate/update a file index. Check for existing file-references.md before expensive codebase exploration.
---

# File Index

Generate and use a `file-references.md` index to minimize token waste when navigating codebases.

## When to Use

**Generate index when:**
- User asks to index/catalog the project
- Starting work on unfamiliar codebase
- Project has no `file-references.md`

**Use existing index when:**
- Looking for where functionality lives
- Need to understand project structure
- Before using Glob/Grep for exploration

**Skip if:**
- Single-file project
- Already know exact file locations
- Index would be stale (major refactor in progress)

## Generating the Index

1. Ask user for scope (or use defaults):
   - Patterns: `**/*.js`, `src/**/*`, etc.
   - Exclude: `node_modules`, `dist`, `*.test.*`

2. Scan matching files and create `file-references.md`:

```markdown
# File References

> Auto-generated index. Update with `/file-index` or delete to regenerate.

## Source Files

| File | Module/Namespace | Description |
|------|------------------|-------------|
| [src/index.js](src/index.js) | `main` | Application entry point |
| [src/utils/format.js](src/utils/format.js) | `utils/format` | String formatting helpers |
| [src/api/client.js](src/api/client.js) | `api/client` | HTTP client wrapper |
```

3. Place in project root (or location user specifies)

## Using the Index

Before exploring code:

```
1. Check: Does file-references.md exist?
2. If yes: Read it FIRST
3. Find relevant files from index
4. Read only those files
```

## Index Entry Format

Each entry needs:
- **File**: Relative path as clickable link
- **Module/Namespace**: Import path or logical grouping
- **Description**: One sentence - what it does, not implementation details

## Keeping Index Fresh

- Regenerate when adding significant new files
- User can run `/file-index` to update
- Delete index if it becomes misleading

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Index includes test files | Exclude `*.test.*`, `*.spec.*` by default |
| Descriptions too detailed | One sentence max, focus on purpose |
| Index in wrong location | Always project root unless specified |
| Ignoring existing index | ALWAYS check for it before exploring |
