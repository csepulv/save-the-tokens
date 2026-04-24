# agent-browser Command Reference

Command reference for the `agent-browser` CLI — a Rust-based headless browser controlled via Bash.

## Quick Start

The daemon starts automatically on first command. Subsequent commands connect to the running daemon. Install with `npm i -g agent-browser`.

## Navigation

| Command | Description |
|---------|-------------|
| `agent-browser open <url>` | Navigate to URL |
| `agent-browser get url` | Print current URL |
| `agent-browser get title` | Print page title |

## Snapshots and the @ref System

`agent-browser snapshot` returns a compact accessibility tree with interactive elements tagged as `@e1`, `@e2`, etc. These refs become selectors for subsequent commands.

| Flag | Description |
|------|-------------|
| `-i` | Include iframe content (auto-detected, inlined) |

**Ref behavior:** Refs work across frame boundaries — interact directly without manual frame switching. If a command fails with a stale ref, re-run `snapshot` to get fresh refs.

**Workflow:** Snapshot first to discover elements, then target them by ref.

```bash
agent-browser snapshot          # see what's on the page
agent-browser click @e3         # click the third interactive element
agent-browser snapshot          # see what changed
```

## Semantic Finding

Locate elements by accessibility attributes rather than CSS selectors. More robust for testing.

```bash
agent-browser find role button click           # click the first button
agent-browser find text "Submit" click         # click element containing "Submit"
agent-browser find label "Email" fill "a@b.c"  # fill input labeled "Email"
agent-browser find testid "save-btn" click     # click by data-testid
agent-browser find placeholder "Search" fill "query"
```

## Interaction

| Command | Description |
|---------|-------------|
| `agent-browser click <sel>` | Click an element |
| `agent-browser dblclick <sel>` | Double-click an element |
| `agent-browser fill <sel> "text"` | Clear field and type text |
| `agent-browser type <sel> "text"` | Type text (appends, no clear) |
| `agent-browser press <key>` | Press a key (Enter, Tab, Escape, etc.) |
| `agent-browser hover <sel>` | Hover over element |
| `agent-browser focus <sel>` | Focus an element |
| `agent-browser select <sel> "val"` | Select dropdown option |
| `agent-browser check <sel>` | Check a checkbox |
| `agent-browser uncheck <sel>` | Uncheck a checkbox |
| `agent-browser scroll <dir> [px]` | Scroll (up/down/left/right) |
| `agent-browser scrollintoview <sel>` | Scroll element into view |
| `agent-browser drag <src> <dst>` | Drag from one element to another |
| `agent-browser upload <sel> <files>` | Upload files to a file input |
| `agent-browser handle_dialog accept` | Accept a dialog |
| `agent-browser handle_dialog dismiss` | Dismiss a dialog |

All selector arguments accept `@e` refs or CSS selectors (`.class`, `#id`, `[attr]`).

## Reading Content

| Command | Description |
|---------|-------------|
| `agent-browser get text [sel]` | Extract text content |
| `agent-browser get html [sel]` | Extract HTML |
| `agent-browser get value <sel>` | Get input/select value |
| `agent-browser get attr <sel> <name>` | Get element attribute |
| `agent-browser get count <sel>` | Count matching elements |
| `agent-browser get styles <sel>` | Get computed styles |

## State Checking

| Command | Description |
|---------|-------------|
| `agent-browser is visible <sel>` | Check if element is visible |
| `agent-browser is enabled <sel>` | Check if element is enabled |
| `agent-browser is checked <sel>` | Check if checkbox/radio is checked |

## Screenshots

| Command | Description |
|---------|-------------|
| `agent-browser screenshot [path]` | Screenshot current page |
| `agent-browser screenshot --annotate [path]` | Screenshot with ref labels overlaid |
| `agent-browser screenshot <sel> [path]` | Screenshot a specific element |

Save screenshots to `/tmp/vqa-<descriptive-name>.png`.

## PDF Export

```bash
agent-browser pdf /tmp/vqa-page-export.pdf
```

## Inspection

| Command | Description |
|---------|-------------|
| `agent-browser console` | Browser console output |
| `agent-browser console --clear` | Clear console messages |
| `agent-browser errors` | Page errors only |
| `agent-browser errors --clear` | Clear error messages |

## Network

| Command | Description |
|---------|-------------|
| `agent-browser network requests` | List all network requests |
| `agent-browser network requests --filter <pattern>` | Filter by URL pattern |
| `agent-browser network requests --type xhr,fetch` | Filter by resource type |
| `agent-browser network requests --method POST` | Filter by HTTP method |
| `agent-browser network requests --status 4xx` | Filter by status code |
| `agent-browser network request <id>` | Get request details |
| `agent-browser network har start` | Start HAR recording |
| `agent-browser network har stop [path]` | Stop HAR recording, save to file |
| `agent-browser network route <url> --body <json>` | Intercept and mock a request |
| `agent-browser network route <url> --abort` | Intercept and abort a request |
| `agent-browser network unroute [url]` | Remove route interception |

## Storage & Cookies

| Command | Description |
|---------|-------------|
| `agent-browser cookies` | List cookies for current page |
| `agent-browser storage local` | Local storage contents |
| `agent-browser storage session` | Session storage contents |

## State Management

| Command | Description |
|---------|-------------|
| `agent-browser state save <name>` | Save cookies + storage to a named state |
| `agent-browser state load <name>` | Restore a saved state |
| `agent-browser state list` | List saved states |
| `agent-browser state show <name>` | Show state contents |
| `agent-browser state clear [name]` | Clear a specific state |
| `agent-browser state clear --all` | Clear all saved states |

## Auth Vault

| Command | Description |
|---------|-------------|
| `agent-browser auth login <name>` | Auto-login with saved profile |
| `agent-browser auth save <name> --url <url> --username <user> --password <pass>` | Save auth profile |
| `agent-browser auth list` | List saved profiles |
| `agent-browser auth delete <name>` | Delete a profile |

See `auth-reference.md` for full auth patterns.

## Tabs & Frames

| Command | Description |
|---------|-------------|
| `agent-browser tab` | List open tabs |
| `agent-browser tab new <url>` | Open URL in new tab |
| `agent-browser frame <sel>` | Switch to a frame |

## Waiting

| Command | Description |
|---------|-------------|
| `agent-browser wait <sel>` | Wait for element to appear |
| `agent-browser wait <ms>` | Wait for duration |
| `agent-browser wait --text "string"` | Wait for text to appear |
| `agent-browser wait --url <pattern>` | Wait for URL to match |
| `agent-browser wait --load networkidle` | Wait for network idle |

## Batch Execution

```bash
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"]
]' | agent-browser batch --json
```

Options:
- `--bail` — Stop on first error (default: continue all)
- `--json` — Output results as JSON array

## Common Patterns

**Navigate, discover, screenshot:**
```bash
agent-browser open http://localhost:3000
agent-browser snapshot
agent-browser screenshot /tmp/vqa-homepage.png
agent-browser console
agent-browser network requests
```

**Fill and submit a form:**
```bash
agent-browser snapshot                           # find form fields
agent-browser fill @e3 "search query"            # fill input
agent-browser click @e5                          # click submit
agent-browser snapshot                           # verify the page changed
```

**Check for failed requests:**
```bash
agent-browser network requests --status 4xx
agent-browser network requests --status 5xx
```

**Verify an interaction worked:**
```bash
agent-browser click @e7                          # click a button
agent-browser snapshot                           # see what changed
agent-browser console                            # check for errors
```

**Record HAR during a test flow:**
```bash
agent-browser network har start
# ... run the test steps ...
agent-browser network har stop /tmp/vqa-flow.har
```

**Mock an API response:**
```bash
agent-browser network route "/api/drawers" --body '{"error": "Service Unavailable"}'
# ... navigate and verify error handling ...
agent-browser network unroute "/api/drawers"
```
