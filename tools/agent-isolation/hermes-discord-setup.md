# Hermes ↔ Discord Setup

Step-by-step guide for wiring a new Hermes container to Discord. Some steps are manual (Discord Developer Portal); others run on the host/container.

---

## 1. Create the Discord bot (manual, in browser)

1. Go to <https://discord.com/developers/applications>
2. **New Application** → name it (e.g. "Hermes-<host>")
3. Left sidebar → **Bot** → **Reset Token** → copy and stash it somewhere safe (you only see it once)
4. On the same Bot page, enable these **Privileged Gateway Intents**:
   - ✅ MESSAGE CONTENT INTENT
   - ✅ SERVER MEMBERS INTENT
   - (PRESENCE INTENT not required)
5. Left sidebar → **OAuth2** → **URL Generator**
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `View Channels`
     - (Add `Attach Files` + `Embed Links` if you want media replies)
   - Copy the generated URL, paste into a browser, pick the target server, **Authorize**
6. For DMs: just message the bot directly from any account that shares a server with it.

---

## 2. Configure Hermes (on the container)

```bash
hermes gateway setup
```

Walks you through entering the bot token and selecting Discord. There is **no** standalone `hermes discord` command — Discord is one of several transports under the unified messaging gateway.

Verify:

```bash
hermes config show | grep -i discord
# expect:  Discord: configured ✓
```

---

## 3. Set the user allowlist

Edit `~/.hermes/.env`:

```
DISCORD_ALLOWED_USERS=<your_discord_user_id>
```

Find your Discord user ID: enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click your own name → Copy User ID.

For quick testing only:
```
GATEWAY_ALLOW_ALL_USERS=true
```
(Don't ship this — anyone who can DM the bot can use the agent.)

---

## 4. Run the gateway (persistent)

⚠️ Inside Docker, **skip** `hermes gateway install` — it's a no-op (no systemd). Don't waste time on it.

Use tmux so the gateway survives shell exits:

```bash
tmux new -s gateway
hermes gateway run
# detach with: Ctrl-b then d
```

To reattach later: `tmux attach -t gateway`

**Better long-term:** put restart policy on the container itself (e.g. `--restart unless-stopped`) with the gateway as the container's entrypoint or as a process supervised by something like s6/runit. Don't bother with a systemd unit inside the container.

Sanity-check it's actually connected (not just running):

```bash
hermes gateway list
# expect:  ✓ default — running
```

`hermes gateway status` only checks the PID — `gateway list` checks the WebSocket connection. Trust `list`.

---

## 5. Pair your Discord account to Hermes

Pairing flow (order matters):

1. From Discord, **DM the bot first** with any message (e.g. "hi")
   - The bot won't respond yet, but the gateway logs a pending pairing request with a code
2. On the host:
   ```bash
   hermes pairing list           # shows pending code(s)
   hermes pairing approve <code> # approve it
   ```
3. Now DM the bot again — it will respond as the agent.

Other subcommands: `hermes pairing revoke <user>`, `hermes pairing clear-pending`.

---

## 6. Gotcha: WebSocket egress

The one issue that bit us on the original container: **Discord's WebSocket gateway (`gateway.discord.gg`) was blocked** even though REST (`discord.com/api/v10/gateway`) worked fine. Symptom in `hermes gateway run` logs:

```
ERROR gateway.run: ✗ discord error: discord connect timed out after 30s
```

Pre-flight check before debugging Hermes config:

```bash
# REST should return JSON with a wss:// URL
curl -s --max-time 10 https://discord.com/api/v10/gateway

# WebSocket endpoint reachability
curl -v --max-time 20 https://gateway.discord.gg/ 2>&1 | tail -20

# Any proxy in the way?
env | grep -i proxy
```

If REST works but WebSocket times out, the problem is **network egress / proxy**, not Hermes. Common causes:
- HTTP proxy that doesn't tunnel CONNECT for long-lived WebSockets
- Corporate firewall filtering persistent outbound connections
- Docker network policy

Fix that at the container/network layer — no amount of Hermes config will help.

---

## 7. Useful things to know once it's running

- **Discord thread = Hermes session.** The gateway maps `(platform, chat_id, thread_id)` → session ID. New thread or DM = fresh session. Same thread = resumed conversation.
- **Non-image attachments don't come through.** Discord gateway forwards message text + inline images only. For `.zip`, `.tar.gz`, `.pdf`, etc., drop the file on the host filesystem and paste the path to the agent.
- **Skills get registered as `/skill` autocomplete** in Discord automatically.
- Cron jobs created with `deliver: discord` go to your home channel; use `deliver: origin` from a thread to keep replies in that thread.

---

## Quick reference

| Task | Command |
|---|---|
| Set up gateway (first time) | `hermes gateway setup` |
| Run gateway | `hermes gateway run` (in tmux) |
| Check actual connection | `hermes gateway list` |
| Check config | `hermes config show` |
| List pending pairings | `hermes pairing list` |
| Approve a pairing | `hermes pairing approve <code>` |
| Edit env (allowlist) | `$EDITOR ~/.hermes/.env` |
