---
name: visual-qa
description: >
  Browser-based visual QA. Supports directed testing (you say what to check) and
  exploratory testing (systematic page discovery and reporting). Uses Chrome
  DevTools MCP, agent-browser CLI, or browse CLI — whichever is available.
---

# Visual QA

**This skill is rigid.** Follow every step in order. Do not skip steps based on your assessment of the situation.

## Setup Check — Tool Detection

Determine which browser tool is available. Check in this order:

1. **agent-browser CLI** — run `agent-browser --version 2>/dev/null && echo "READY" || echo "NOT_FOUND"`. If READY, set tool mode to **agent-browser**.
2**Chrome DevTools MCP** — check if any MCP tools starting with `chrome-devtools` are available (e.g., `navigate_page`, `take_screenshot`). If yes, set tool mode to **devtools**.
3. **browse CLI** — run `browse url 2>/dev/null && echo "READY" || echo "NOT_FOUND"`. If READY, set tool mode to **browse**.
4. **Neither** — tell the user: "No browser tool available. Install Chrome DevTools MCP, agent-browser, or the browse CLI."

Announce which tool you're using before proceeding.

## Step 1: Mode Selection

Ask the user:

> **Directed or exploratory?**
> - **Directed:** Tell me what to look at and what to check.
> - **Exploratory:** Give me a URL. I'll discover pages, screenshot what I find, and report issues.

Wait for the user's answer. Do not guess.

## Step 2: Auth Gate

Ask the user:

> **Does this app require authentication?**

If yes: read `auth-reference.md` in this skill directory and handle login before proceeding to Step 3.

If no or unsure: proceed to Step 3.

## Step 3: Load Command Reference

Based on the tool mode detected in Setup Check:

- **devtools** → read `devtools-reference.md` in this skill directory
- **agent-browser** → read `agent-browser-reference.md` in this skill directory
- **browse** → read `browse-reference.md` in this skill directory

## Step 4: Execute

### Directed Mode

Follow the user's instructions. For every page or state you check:

1. **Screenshot it.** Save to `/tmp/vqa-<descriptive-name>.png`.
2. **Check the console.** Report any errors or warnings.
3. **Check for failed network requests.** Report any 4xx/5xx responses.
4. **Report what you found.** Include the screenshot path, console output, and network failures.

### Exploratory Mode

1. Navigate to the given URL
2. Take a snapshot (accessibility tree / page structure)
3. Screenshot the page to `/tmp/vqa-<page-name>.png`
4. Check console for errors/warnings
5. Check for failed network requests
6. Extract navigation links
7. Follow links to discover additional pages (limit: 2 levels deep from the starting URL, max 10 pages total)
8. For each discovered page, repeat steps 2-5
9. Report all findings with screenshot evidence

**Depth limit:** Do not follow links beyond 2 levels from the starting URL. Do not visit more than 10 pages total. If you hit either limit, report what you found and list unvisited links.

## Reporting

For each page visited, report:

- **URL**
- **Screenshot** (file path)
- **Console errors/warnings** (or "none")
- **Failed network requests** (or "none")
- **Issues found** (visual problems, broken interactions, unexpected states)

At the end, provide a summary: pages visited, total issues, and severity (errors vs. warnings vs. visual issues).

## Non-Negotiable Rules

### Screenshot Evidence

Every claim about a page's state requires a screenshot. No exceptions.

| Excuse | Reality |
|--------|---------|
| "The page looks correct from the markup" | Markup is not rendering. Screenshot it. |
| "I already verified this in code" | Code correctness ≠ visual correctness. Browse it. |
| "The screenshot would be redundant" | Redundant evidence is still evidence. Take it. |

### Console Checking

On every page you visit, check the console after the page loads. Report any errors or warnings. This is not optional.

| Excuse | Reality |
|--------|---------|
| "The page rendered fine" | Rendering ≠ error-free. Check the console. |
| "Console errors are just warnings" | Warnings in production are bugs waiting. Report them. |
| "I already checked a similar page" | Each page has its own console state. Check it. |

## What This Skill Does NOT Do

- Auto-fix bugs (reports only — you decide what to act on)
- Generate regression tests
- Score or grade page health
- Auto-trigger on UI changes (explicit invocation only)
