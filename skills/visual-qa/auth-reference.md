# Authentication Reference

Patterns for handling login-gated apps. Read this when the user confirms the app requires authentication.

---

## DevTools MCP Auth

### Option 1: Connect to an Authenticated Browser (recommended)

If the user is already logged in via their regular browser, connect DevTools MCP to that browser instance instead of launching a new one. The user needs to start Chrome with remote debugging enabled:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Then configure the MCP server to connect via `--browser-url http://localhost:9222`. This inherits the existing session — no login needed.

Tell the user: **"Start Chrome with remote debugging on port 9222, then I'll connect to your existing session."**

### Option 2: Manual Login Flow

Log in through the DevTools-controlled browser:

1. `navigate_page` to the login URL
2. `take_snapshot` — identify form fields
3. `fill` username and password fields (ask the user for credentials — **never guess**)
4. `click` the submit button
5. `take_snapshot` — verify redirect to authenticated page
6. `take_screenshot` to `/tmp/vqa-auth-verify.png` — confirm visually

### Verifying Auth Status

After any auth method:

```
navigate_page({ url: "<protected-url>" })
take_screenshot({ path: "/tmp/vqa-auth-check.png" })
```

If the page shows a login form instead of the expected content, auth failed. Ask the user for help.

---

## Browse CLI Auth

### Option 1: Cookie Import from Browser (recommended)

Import cookies from an existing logged-in browser session.

```bash
browse cookie-import-browser
```

This auto-detects installed Chromium browsers (Chrome, Arc, Brave, Edge, Comet) and opens an interactive picker UI where the user can:
- Switch between installed browsers
- Search for cookie domains
- Click "+" to import a domain's cookies

Tell the user: **"Cookie picker opened in your browser — select the domains you need, then tell me when you're done."**

Wait for the user to confirm before proceeding.

**Direct import (skip the UI):**
```bash
browse cookie-import-browser chrome --domain example.com
```

**Notes:**
- First import per browser may trigger a macOS Keychain dialog — user should click "Allow"
- Cookies persist for the browse session — import once, use for all subsequent commands

### Option 2: Cookie Import from File

```bash
browse cookie-import cookies.json
```

The file should contain a JSON array of cookie objects.

### Option 3: Manual Login Flow

1. `browse goto <login-url>`
2. `browse snapshot` — identify username/password fields and submit button
3. `browse fill @eN "username"`
4. `browse fill @eM "password"`
5. `browse click @eK` (submit button)
6. `browse url` — verify redirect to authenticated page
7. `browse screenshot /tmp/vqa-auth-verify.png` — confirm visually

**Never guess or hardcode credentials.** If the user hasn't provided them, ask.

### Verifying Auth Status

```bash
browse cookies
browse goto <protected-url>
browse screenshot /tmp/vqa-auth-check.png
```

If the page shows a login form instead of the expected content, auth failed. Ask the user for help.

---

## agent-browser Auth

### Option 1: Load Saved State (recommended)

If auth state was previously saved, restore it:

```bash
agent-browser state load <name>
```

This restores cookies, localStorage, and sessionStorage from a prior session. The user (or a setup script) saves state after a manual login:

```bash
agent-browser state save auth/my-app
```

Tell the user: **"Do you have a saved auth state? If not, log in manually and I'll save it for reuse."**

### Option 2: Auth Vault (saved credentials)

If the user has stored credentials in agent-browser's auth vault:

```bash
agent-browser auth login <name>
```

This navigates to the login URL, waits for form fields, and auto-fills. To save a new profile:

```bash
agent-browser auth save <name> --url <login-url> --username <user> --password <pass>
```

**Never store credentials yourself.** Ask the user to run `auth save` or provide a saved profile name.

### Option 3: Manual Login Flow

1. `agent-browser open <login-url>`
2. `agent-browser snapshot` — identify username/password fields and submit button
3. `agent-browser fill @eN "username"`
4. `agent-browser fill @eM "password"`
5. `agent-browser click @eK` (submit button)
6. `agent-browser get url` — verify redirect to authenticated page
7. `agent-browser screenshot /tmp/vqa-auth-verify.png` — confirm visually
8. `agent-browser state save auth/<app-name>` — save for future runs

**Never guess or hardcode credentials.** If the user hasn't provided them, ask.

### Verifying Auth Status

```bash
agent-browser open <protected-url>
agent-browser screenshot /tmp/vqa-auth-check.png
```

If the page shows a login form instead of the expected content, auth failed. Ask the user for help.

---

## When Auth Fails (All Tools)

Don't waste commands retrying. If the first approach doesn't work:
1. Report what happened (screenshot + URL)
2. Ask the user which approach to try next
3. If none work, ask the user to handle auth manually and provide cookies or a connected browser session
