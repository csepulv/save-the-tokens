# Browse Command Reference

Command cheatsheet for the `browse` CLI — a headless Chromium browser controlled via Bash.

## Quick Start

The browse server starts automatically on first command (~3s). Subsequent commands are ~100-200ms. The server shuts down after 30 minutes idle.

## Navigation

| Command | Description |
|---------|-------------|
| `browse goto <url>` | Navigate to URL |
| `browse back` | Go back |
| `browse forward` | Go forward |
| `browse reload` | Reload current page |
| `browse url` | Print current URL |

## Snapshots and the @ref System

`browse snapshot` returns an accessibility tree with interactive elements tagged as `@e1`, `@e2`, etc. These refs become selectors for subsequent commands (click, fill, etc.).

| Flag | Description |
|------|-------------|
| `-i` | Interactive elements only |
| `-D` | Diff against previous snapshot (shows what changed) |
| `-a` | Annotated screenshot with ref labels overlaid |
| `-o <path>` | Output path for annotated screenshot |
| `-C` | Include cursor-interactive elements (`@c1`, `@c2` — divs with onclick, cursor:pointer) |

**Ref staleness:** In SPAs, DOM mutations can make refs stale. If a command fails with a stale ref error, re-run `browse snapshot` to get fresh refs.

**Workflow:** Snapshot first to discover elements, then target them by ref.

```
browse snapshot          # see what's on the page
browse click @e3         # click the third interactive element
browse snapshot -D       # see what changed
```

## Interaction

| Command | Description |
|---------|-------------|
| `browse click <sel>` | Click an element |
| `browse fill <sel> "text"` | Clear field and type text |
| `browse select <sel> "option"` | Select dropdown option |
| `browse hover <sel>` | Hover over element |
| `browse type "text"` | Type text (no target — types into focused element) |
| `browse press <key>` | Press a key (Enter, Tab, Escape, etc.) |
| `browse scroll <direction> <amount>` | Scroll (up/down/left/right, amount in px) |
| `browse upload <sel> <filepath>` | Upload a file to a file input |

All selector arguments accept `@e`/`@c` refs or CSS selectors (`.class`, `#id`, `[attr]`).

## Screenshots

| Mode | Syntax |
|------|--------|
| Full page (default) | `browse screenshot [path]` |
| Viewport only | `browse screenshot --viewport [path]` |
| Element crop | `browse screenshot @e3 [path]` or `browse screenshot "#sel" [path]` |
| Region clip | `browse screenshot --clip x,y,w,h [path]` |

Default save location is auto-generated. Specify a path to control where screenshots are saved.

## Reading Content

| Command | Description |
|---------|-------------|
| `browse text [sel]` | Extract text content |
| `browse html [sel]` | Extract HTML |
| `browse links` | List all links on the page |
| `browse forms` | List all forms and their fields |
| `browse accessibility` | Full accessibility tree |

## Inspection

| Command | Description |
|---------|-------------|
| `browse console` | Browser console output (errors, warnings, logs) |
| `browse network` | Network requests log |
| `browse js "expression"` | Evaluate JavaScript (supports `await`) |
| `browse css <sel> <property>` | Get computed CSS value |
| `browse attrs <sel>` | Get element attributes |
| `browse is <sel> <state>` | Check state: visible, hidden, enabled, disabled, checked, editable, focused |
| `browse cookies` | List cookies for current page |
| `browse storage` | Local/session storage contents |
| `browse perf` | Performance metrics |

## Viewport

```
browse viewport <width> <height>
```

Useful for responsive testing:
- Mobile: `browse viewport 375 812`
- Tablet: `browse viewport 768 1024`
- Desktop: `browse viewport 1440 900`

## Tabs

| Command | Description |
|---------|-------------|
| `browse tabs` | List open tabs |
| `browse tab <n>` | Switch to tab N |
| `browse newtab <url>` | Open URL in new tab |
| `browse closetab` | Close current tab |

## Dialogs

Dialogs (alert, confirm, prompt) are auto-accepted by default.

| Command | Description |
|---------|-------------|
| `browse dialog-accept [text]` | Accept next dialog (with optional prompt text) |
| `browse dialog-dismiss` | Dismiss next dialog |
| `browse dialog` | Show dialog history |

## Comparing Pages

```
browse diff <url1> <url2>
```

Opens both URLs, takes snapshots, returns a unified diff of their accessibility trees.

## Common Patterns

**Navigate, discover, screenshot:**
```bash
browse goto http://localhost:3000
browse snapshot
browse screenshot /tmp/homepage.png
browse console
```

**Fill and submit a form:**
```bash
browse snapshot                    # find form fields
browse fill @e3 "search query"    # fill input
browse click @e5                  # click submit
browse snapshot -D                # verify the page changed
```

**Check responsive layout:**
```bash
browse viewport 375 812
browse screenshot /tmp/mobile.png
browse viewport 1440 900
browse screenshot /tmp/desktop.png
```

**Verify an interaction worked:**
```bash
browse click @e7                  # click a button
browse snapshot -D                # diff shows what changed
browse console                    # check for errors
```

**Batch commands:**
```bash
echo '[{"cmd":"goto","args":["http://localhost:3000"]},{"cmd":"screenshot","args":["/tmp/batch.png"]}]' | browse chain
```
