import { derivePageLabel } from './page-labels.js';

// Captures network from extension targets (service workers + extension
// pages — popup / sidepanel / options) via CDP. Spec'd in
// docs/sekko/epics/trace-extensions/. Spike validation in
// scripts/spike-cdp-sw-network.mjs (2026-04-29) confirmed the mechanism
// works end-to-end including Network.getResponseBody for full bodies.
//
// The module opens its own CDP session against the supplied page. It
// listens for chrome-extension://-typed targets (both service_worker
// and page types), attaches via Target.attachToTarget (legacy nested
// mode), enables Network on each session via Target.sendMessageToTarget,
// and accumulates entries by requestId. On stop(), it waits for any
// in-flight body fetches, sanitizes, and returns entries.
//
// Design note: a separate CDP session from the popup-detection logic in
// trace.js. Tracked as a sustainability item to consolidate later.

export async function startExtensionCapture({ context, page, sanitize = identity, deps = {} } = {}) {
  if (!context) throw new Error('context is required');
  if (!page) throw new Error('page is required');

  const { now = () => Date.now() } = deps;
  const cdp = await context.newCDPSession(page);

  const swSessions = new Map(); // sessionId -> { targetId, url, origin, extensionId }
  const inFlightAttaches = new Set(); // targetIds attaching right now (race-safe dedup)
  const entries = new Map(); // requestId -> entry being built up
  const inFlightBodyFetches = new Set(); // pending Promise instances
  const pendingCmds = new Map(); // cmdId -> { kind, requestId }
  let nextCmdId = 1;

  function deriveOrigin(targetInfo) {
    if (targetInfo.type === 'service_worker') return 'service-worker';
    const label = derivePageLabel(targetInfo.url);
    return label || 'extension';
  }

  function extensionIdFromUrl(url) {
    const match = url.match(/^chrome-extension:\/\/([^/]+)/);
    return match ? match[1] : null;
  }

  async function attachToTarget(targetInfo) {
    if (!targetInfo?.url || !targetInfo.url.startsWith('chrome-extension://')) return;
    const isExtensionTarget =
      targetInfo.type === 'service_worker' || targetInfo.type === 'page';
    if (!isExtensionTarget) return;

    // Race-safe dedup: synchronous check + add before any await.
    if (inFlightAttaches.has(targetInfo.targetId)) return;
    for (const v of swSessions.values()) {
      if (v.targetId === targetInfo.targetId) return;
    }
    inFlightAttaches.add(targetInfo.targetId);

    try {
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: targetInfo.targetId,
        flatten: false,
      });
      swSessions.set(sessionId, {
        targetId: targetInfo.targetId,
        url: targetInfo.url,
        origin: deriveOrigin(targetInfo),
        extensionId: extensionIdFromUrl(targetInfo.url),
      });
      await sendToSession(sessionId, 'Network.enable', {});
    } catch {
      // Target may have gone away between discover and attach; silent.
    } finally {
      inFlightAttaches.delete(targetInfo.targetId);
    }
  }

  async function sendToSession(sessionId, method, params, kind = null, ctx = null) {
    const cmdId = nextCmdId++;
    if (kind) pendingCmds.set(cmdId, { kind, ...ctx });
    return cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: cmdId, method, params: params || {} }),
    });
  }

  function scheduleBodyFetch(requestId, sessionId) {
    const promise = sendToSession(
      sessionId,
      'Network.getResponseBody',
      { requestId },
      'getResponseBody',
      { requestId, sessionId }
    ).catch(() => {});
    inFlightBodyFetches.add(promise);
    promise.finally(() => inFlightBodyFetches.delete(promise));
  }

  function handleSessionMessage(params) {
    const session = swSessions.get(params.sessionId);
    if (!session) return;
    let msg;
    try { msg = JSON.parse(params.message); } catch { return; }

    // Command response (id present, no method)
    if (msg.id !== undefined) {
      const ctx = pendingCmds.get(msg.id);
      pendingCmds.delete(msg.id);
      if (!ctx) return;
      if (ctx.kind === 'getResponseBody' && !msg.error) {
        const entry = entries.get(ctx.requestId);
        if (entry && typeof msg.result?.body === 'string') {
          entry.responseBody = msg.result.base64Encoded
            ? `[base64; ${msg.result.body.length} chars]`
            : msg.result.body;
        }
      }
      return;
    }

    if (!msg.method) return;
    handleNetworkEvent(msg, session, params.sessionId);
  }

  function handleNetworkEvent(msg, session, sessionId) {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      entries.set(msg.params.requestId, {
        origin: session.origin,
        extensionId: session.extensionId,
        method: r.method || 'GET',
        url: r.url,
        status: null,
        statusText: null,
        mimeType: null,
        startedDateTime: new Date(msg.params.wallTime * 1000).toISOString(),
        durationMs: null,
        requestBody: r.postData || null,
        responseBody: null,
        errorText: null,
        // Internal — stripped on output
        _startTs: msg.params.timestamp,
        _sessionId: sessionId,
        _requestId: msg.params.requestId,
      });
    } else if (msg.method === 'Network.responseReceived') {
      const entry = entries.get(msg.params.requestId);
      if (!entry) return;
      const r = msg.params.response;
      entry.status = r.status;
      entry.statusText = r.statusText || '';
      entry.mimeType = r.mimeType || null;
    } else if (msg.method === 'Network.loadingFinished') {
      const entry = entries.get(msg.params.requestId);
      if (!entry) return;
      if (entry._startTs) {
        entry.durationMs = Math.round((msg.params.timestamp - entry._startTs) * 1000);
      }
      scheduleBodyFetch(msg.params.requestId, sessionId);
    } else if (msg.method === 'Network.loadingFailed') {
      const entry = entries.get(msg.params.requestId);
      if (!entry) return;
      entry.errorText = msg.params.errorText || 'unknown';
    }
  }

  cdp.on('Target.receivedMessageFromTarget', handleSessionMessage);
  cdp.on('Target.targetCreated', (p) => attachToTarget(p.targetInfo));
  cdp.on('Target.targetInfoChanged', (p) => attachToTarget(p.targetInfo));

  await cdp.send('Target.setDiscoverTargets', { discover: true });

  // Attach to already-existing targets
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const ti of targetInfos || []) {
      attachToTarget(ti); // intentional fire-and-forget; dedup handles overlap with targetCreated
    }
  } catch {
    // setDiscoverTargets/getTargets unavailable on this connection — proceed without
  }

  return {
    async stop({ timeoutMs = 3000 } = {}) {
      // Wait for in-flight body fetches, with a cap so a hung session
      // can't block session shutdown forever.
      if (inFlightBodyFetches.size > 0) {
        await Promise.race([
          Promise.allSettled([...inFlightBodyFetches]),
          new Promise((r) => setTimeout(r, timeoutMs)),
        ]);
      }

      const out = [];
      for (const entry of entries.values()) {
        const { _startTs, _sessionId, _requestId, ...clean } = entry;
        out.push(sanitize(clean));
      }
      return { count: out.length, entries: out, sessionsAttached: swSessions.size };
    },
  };
}

function identity(x) { return x; }
