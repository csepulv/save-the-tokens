# Chrome DevTools MCP — Command Reference

Tool reference for the Chrome DevTools MCP server. All commands are MCP tool calls, not bash commands.

## Navigation

| Tool | Parameters | Description |
|------|-----------|-------------|
| `navigate_page` | `url` | Navigate to URL |
| `new_page` | `url` | Open URL in a new tab |
| `list_pages` | | List all open tabs |
| `select_page` | `index` | Switch to tab by index |
| `close_page` | | Close current tab |
| `wait_for` | `selector`, `timeout` | Wait for an element to appear |

## Screenshots & Snapshots

| Tool | Parameters | Description |
|------|-----------|-------------|
| `take_screenshot` | `path` | Screenshot current page |
| `take_snapshot` | | Accessibility tree snapshot |

Save screenshots to `/tmp/vqa-<descriptive-name>.png`.

## Interaction

| Tool | Parameters | Description |
|------|-----------|-------------|
| `click` | `selector` | Click an element |
| `fill` | `selector`, `value` | Clear a field and type text |
| `fill_form` | `fields` | Fill multiple form fields at once |
| `hover` | `selector` | Hover over element |
| `type_text` | `text` | Type into focused element |
| `press_key` | `key` | Press a key (Enter, Tab, Escape, etc.) |
| `drag` | `from`, `to` | Drag from one point to another |
| `upload_file` | `selector`, `path` | Upload a file |
| `handle_dialog` | `action`, `text` | Accept or dismiss a dialog |

Selectors are CSS selectors (`#id`, `.class`, `[attr]`, etc.).

## Inspection

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_console_messages` | | All console output (errors, warnings, logs) |
| `get_console_message` | `index` | Get a specific console message |
| `list_network_requests` | | All network requests |
| `get_network_request` | `index` | Get details of a specific request |
| `evaluate_script` | `expression` | Run JavaScript in the page |

## Viewport & Emulation

| Tool | Parameters | Description |
|------|-----------|-------------|
| `emulate` | `device`, `width`, `height` | Set device or viewport size |
| `resize_page` | `width`, `height` | Resize the viewport |

Responsive testing sizes:
- Mobile: `resize_page` with `width: 375, height: 812`
- Tablet: `resize_page` with `width: 768, height: 1024`
- Desktop: `resize_page` with `width: 1440, height: 900`

## Common Patterns

**Navigate, discover, screenshot:**
```
navigate_page({ url: "http://localhost:3000" })
take_snapshot()
take_screenshot({ path: "/tmp/vqa-homepage.png" })
list_console_messages()
list_network_requests()
```

**Fill and submit a form:**
```
take_snapshot()                              # find form fields
fill({ selector: "#email", value: "user@example.com" })
fill({ selector: "#password", value: "secret" })
click({ selector: "button[type=submit]" })
take_snapshot()                              # verify result
```

**Check for failed requests:**
```
list_network_requests()
# Look for any responses with status 4xx or 5xx
```

**Verify an interaction worked:**
```
click({ selector: ".submit-btn" })
take_snapshot()                              # see what changed
list_console_messages()                      # check for errors
```
