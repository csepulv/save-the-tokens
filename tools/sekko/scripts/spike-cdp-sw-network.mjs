#!/usr/bin/env node
// Spike: log network requests made by an extension's service worker
// (background script) via CDP. Validates whether SW network is
// observable at the protocol layer when Playwright's high-level APIs
// don't surface it.
//
// Approach:
//   1. Open a page-level CDP session.
//   2. Target.setDiscoverTargets to see all targets in the browser.
//   3. For each existing service_worker target, and any new one,
//      Target.attachToTarget (non-flatten, legacy nested protocol).
//   4. Send Network.enable to each SW session via
//      Target.sendMessageToTarget — wraps the inner CDP message.
//   5. Receive Network.* events back via Target.receivedMessageFromTarget,
//      route by sessionId. Log requests with timestamp.
//
// Why non-flatten: Playwright's public CDPSession.send() doesn't expose
// a sessionId-routed send, so flatten-mode attach would deliver events
// without a clean way to associate them with the right SW session.
// The deprecated nested protocol is verbose but routes cleanly via the
// sessionId on the event payload.
//
// Usage:
//   node scripts/spike-cdp-sw-network.mjs <url> \
//     [--connect [http-url]] \                   # attach to running Chrome (default 127.0.0.1:9222)
//     [--load-extension <path>] \                # only with launch (not --connect)
//     [--user-data-dir <path> | --profile <name>]  # only with launch (not --connect)
//
// Examples:
//
// Launched Chromium with JD extension (no CF-protected sites):
//   node scripts/spike-cdp-sw-network.mjs https://v3.junkdrawer.io \
//     --profile jd \
//     --load-extension /Users/chris/workspace/junkdrawer/apps/browser-extension/dist/production
//
// Attach to your running Canary (extension already installed there;
// CF-protected sites accessible because logins are real):
//   node scripts/spike-cdp-sw-network.mjs https://claude.ai --connect

import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';

function parseArgs(argv) {
  const out = { url: null, loadExtension: null, userDataDir: null, profile: null, connect: null };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--load-extension') { out.loadExtension = argv[++i]; }
    else if (a === '--user-data-dir') { out.userDataDir = argv[++i]; }
    else if (a === '--profile') { out.profile = argv[++i]; }
    else if (a === '--connect') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--') && next.startsWith('http')) {
        out.connect = next;
        i++;
      } else {
        out.connect = 'http://127.0.0.1:9222';
      }
    }
    else if (!out.url && !a.startsWith('--')) { out.url = a; }
    i++;
  }
  if (!out.url) {
    console.error('Usage: node scripts/spike-cdp-sw-network.mjs <url> [--connect [url]] [--load-extension <path>] [--user-data-dir <path> | --profile <name>]');
    process.exit(1);
  }
  if (out.connect && (out.loadExtension || out.userDataDir || out.profile)) {
    console.error('Error: --connect is mutually exclusive with --load-extension / --user-data-dir / --profile (the connected browser owns its profile).');
    process.exit(1);
  }
  return out;
}

function resolveProfileDir(args) {
  if (args.userDataDir) return resolve(args.userDataDir);
  if (args.profile) {
    const dir = join(homedir(), '.sekko', 'profiles', args.profile);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return mkdtempSync(join(tmpdir(), 'sekko-sw-spike-'));
}

function ts() {
  return new Date().toISOString().slice(11, 23);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let context, page, cleanup = () => {};

  if (args.connect) {
    const connectUrl = args.connect.replace(/^(https?:\/\/)localhost(?=[:/]|$)/, '$1127.0.0.1');
    console.log(`[${ts()}] connecting to ${connectUrl}`);
    console.log(`[${ts()}] url:         ${args.url}`);
    const browser = await chromium.connectOverCDP(connectUrl);
    context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    cleanup = async () => { await browser.close(); }; // CDP browser.close() detaches, doesn't quit
  } else {
    const profileDir = resolveProfileDir(args);
    const isTemp = !args.userDataDir && !args.profile;
    const launchArgs = [];
    if (args.loadExtension) {
      const extPath = resolve(args.loadExtension);
      launchArgs.push(`--disable-extensions-except=${extPath}`);
      launchArgs.push(`--load-extension=${extPath}`);
    }

    console.log(`[${ts()}] launching chromium`);
    console.log(`[${ts()}] profile dir: ${profileDir}${isTemp ? ' (temp; will be deleted)' : ''}`);
    if (args.loadExtension) console.log(`[${ts()}] extension:   ${args.loadExtension}`);
    console.log(`[${ts()}] url:         ${args.url}`);

    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      args: launchArgs,
    });
    page = context.pages()[0] || await context.newPage();
    cleanup = async () => {
      await context.close();
      if (isTemp) rmSync(profileDir, { recursive: true, force: true });
    };
  }

  const cdp = await context.newCDPSession(page);

  // Track which sessionIds correspond to SW targets we attached to.
  const swSessions = new Map(); // sessionId -> { targetId, url }
  // Map outgoing CDP-message id → context, so the response handler can
  // tell what was requested (currently used for getResponseBody).
  const pendingCmds = new Map(); // cmdId -> { kind, requestId, url, sessionId }
  // Track requestId → url across requestWillBeSent / loadingFinished
  // so getResponseBody knows what URL it's fetching the body for.
  const requestUrls = new Map(); // requestId -> url
  let reqCount = 0;
  let resCount = 0;
  let failCount = 0;
  let bodyOkCount = 0;
  let bodyErrCount = 0;
  let bodyEmptyCount = 0;
  let nextMsgId = 1;

  async function attachAndEnableNetwork(targetInfo) {
    if (!targetInfo.url || !targetInfo.url.startsWith('chrome-extension://')) {
      console.log(`[${ts()}] (skipping non-extension SW: ${targetInfo.url})`);
      return;
    }
    // Dedup: setDiscoverTargets fires targetCreated for existing targets
    // AND Target.getTargets enumerates them — same target, different paths.
    for (const v of swSessions.values()) {
      if (v.targetId === targetInfo.targetId) return;
    }
    try {
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: targetInfo.targetId,
        flatten: false,
      });
      swSessions.set(sessionId, { targetId: targetInfo.targetId, url: targetInfo.url });
      console.log(`[${ts()}] ATTACHED  url=${targetInfo.url}`);
      console.log(`             sessionId=${sessionId}`);

      // Enable Network and Runtime on the SW session. Response IDs let
      // us verify each command actually succeeded; Runtime gives us
      // SW console.log output as a heartbeat that the bridge works.
      const networkEnableId = nextMsgId++;
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: networkEnableId, method: 'Network.enable', params: {} }),
      });
      console.log(`[${ts()}] (Network.enable sent to SW, msg.id=${networkEnableId})`);

      const runtimeEnableId = nextMsgId++;
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: runtimeEnableId, method: 'Runtime.enable', params: {} }),
      });
      console.log(`[${ts()}] (Runtime.enable sent to SW, msg.id=${runtimeEnableId})`);
    } catch (err) {
      console.error(`[${ts()}] attach/enable failed for ${targetInfo.targetId}: ${err.message}`);
    }
  }

  await cdp.send('Target.setDiscoverTargets', { discover: true });

  // Catch SW targets created after this point
  cdp.on('Target.targetCreated', async (params) => {
    if (params.targetInfo.type === 'service_worker') {
      await attachAndEnableNetwork(params.targetInfo);
    }
  });

  // Some SW targets may be born unattached and only get a chrome-extension
  // URL on the InfoChanged event — same pattern as the popup spike.
  cdp.on('Target.targetInfoChanged', async (params) => {
    if (params.targetInfo.type !== 'service_worker') return;
    // Already attached?
    for (const v of swSessions.values()) {
      if (v.targetId === params.targetInfo.targetId) return;
    }
    await attachAndEnableNetwork(params.targetInfo);
  });

  // Attach to any service_worker targets that already exist at startup
  const { targetInfos } = await cdp.send('Target.getTargets');
  for (const ti of targetInfos) {
    if (ti.type === 'service_worker') {
      await attachAndEnableNetwork(ti);
    }
  }

  // Receive messages from SW sessions
  cdp.on('Target.receivedMessageFromTarget', (params) => {
    if (!swSessions.has(params.sessionId)) return;
    let msg;
    try { msg = JSON.parse(params.message); }
    catch { return; }

    // Command response (no method, has id)
    if (msg.id !== undefined) {
      const ctx = pendingCmds.get(msg.id);
      pendingCmds.delete(msg.id);
      if (msg.error) {
        if (ctx?.kind === 'getResponseBody') {
          bodyErrCount++;
          console.log(`[${ts()}] BODY ERR  ${msg.error.code} ${msg.error.message.slice(0, 80)}  url=${ctx.url.slice(0, 80)}`);
        } else {
          console.log(`[${ts()}] CMD ERR id=${msg.id} code=${msg.error.code} ${msg.error.message}`);
        }
        return;
      }
      if (ctx?.kind === 'getResponseBody') {
        const body = msg.result?.body;
        const enc = msg.result?.base64Encoded ? '[base64]' : '       ';
        if (typeof body !== 'string') {
          bodyEmptyCount++;
          console.log(`[${ts()}] BODY ??   ${enc} no body in result  url=${ctx.url.slice(0, 80)}`);
        } else if (body.length === 0) {
          bodyEmptyCount++;
          console.log(`[${ts()}] BODY 0    ${enc} empty                url=${ctx.url.slice(0, 80)}`);
        } else {
          bodyOkCount++;
          const preview = body.slice(0, 80).replace(/\s+/g, ' ');
          console.log(`[${ts()}] BODY OK   ${enc} ${String(body.length).padStart(6)}b  url=${ctx.url.slice(0, 80)}`);
          if (preview && !msg.result.base64Encoded) {
            console.log(`             preview: ${preview}…`);
          }
        }
        return;
      }
      console.log(`[${ts()}] CMD OK  id=${msg.id} ✓`);
      return;
    }

    if (!msg.method) return;

    if (msg.method === 'Network.requestWillBeSent') {
      reqCount++;
      const r = msg.params.request;
      const initiator = msg.params.initiator?.type || '?';
      requestUrls.set(msg.params.requestId, r.url);
      console.log(`[${ts()}] SW REQ #${reqCount}  ${(r.method || 'GET').padEnd(6)} ${r.url.slice(0, 110)}  init=${initiator}`);
    } else if (msg.method === 'Network.responseReceived') {
      resCount++;
      const r = msg.params.response;
      console.log(`[${ts()}] SW RES        ${String(r.status).padEnd(3)}    ${r.url.slice(0, 110)}`);
    } else if (msg.method === 'Network.loadingFinished') {
      // Request body-fetch for this request — what M1 will need.
      const requestId = msg.params.requestId;
      const url = requestUrls.get(requestId) || '?';
      const cmdId = nextMsgId++;
      pendingCmds.set(cmdId, { kind: 'getResponseBody', requestId, url, sessionId: params.sessionId });
      cdp.send('Target.sendMessageToTarget', {
        sessionId: params.sessionId,
        message: JSON.stringify({ id: cmdId, method: 'Network.getResponseBody', params: { requestId } }),
      }).catch(() => {});
    } else if (msg.method === 'Network.loadingFailed') {
      failCount++;
      console.log(`[${ts()}] SW FAIL       ${msg.params.errorText} requestId=${msg.params.requestId}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const argText = (msg.params.args || []).map((a) => a.value ?? a.description ?? `<${a.type}>`).join(' ');
      console.log(`[${ts()}] SW LOG  [${msg.params.type}] ${argText.slice(0, 200)}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log(`[${ts()}] SW EXC  ${msg.params.exceptionDetails?.text || ''} ${msg.params.exceptionDetails?.exception?.description || ''}`);
    }
  });

  console.log(`[${ts()}] navigating to ${args.url}`);
  await page.goto(args.url);

  console.log('');
  console.log('Browser is open. Trigger SW activity:');
  console.log('  - Click the extension toolbar icon to open the popup');
  console.log('  - Inside the popup, do something that calls back to the extension');
  console.log('    (e.g., save a bookmark, sync, refresh) — these typically');
  console.log('    flow through the background service worker');
  console.log('Close the page (or browser) to end. SW network events print above.');
  console.log('');

  await new Promise((resolvePromise) => {
    const checkClose = () => {
      if (context.pages().length === 0) resolvePromise();
    };
    page.on('close', checkClose);
    context.on('page', (newPage) => {
      newPage.on('close', checkClose);
    });
  });

  // Give in-flight body fetches a moment to settle before the summary
  if (pendingCmds.size > 0) {
    console.log(`[${ts()}] waiting on ${pendingCmds.size} in-flight body fetches...`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('');
  console.log(`[${ts()}] session ended.`);
  console.log(`  SW sessions attached: ${swSessions.size}`);
  console.log(`  SW REQUEST events:    ${reqCount}`);
  console.log(`  SW RESPONSE events:   ${resCount}`);
  console.log(`  SW FAILED events:     ${failCount}`);
  console.log(`  Body fetches:`);
  console.log(`    OK:     ${bodyOkCount}`);
  console.log(`    Empty:  ${bodyEmptyCount}  (chunked transfer / redirect / etc.)`);
  console.log(`    Errors: ${bodyErrCount}`);

  await cleanup();
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
