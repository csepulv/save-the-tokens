import { test, expect, describe, vi } from 'vitest';
import { EventEmitter } from 'events';
import { startExtensionCapture } from '../cdp-extension-capture.js';

// Mock CDPSession for unit tests. Drives target events and Network
// events scripted by the test, returns canned responses for
// Target.attachToTarget / Target.sendMessageToTarget.
function createMockCdp({ existingTargets = [], onSend } = {}) {
  const emitter = new EventEmitter();
  const sent = [];
  let nextSessionId = 1;
  const cdp = {
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    sent,
    async send(method, params) {
      sent.push({ method, params });
      if (onSend) {
        const override = await onSend(method, params);
        if (override !== undefined) return override;
      }
      if (method === 'Target.setDiscoverTargets') return {};
      if (method === 'Target.getTargets') return { targetInfos: existingTargets };
      if (method === 'Target.attachToTarget') {
        return { sessionId: `mock-session-${nextSessionId++}` };
      }
      if (method === 'Target.sendMessageToTarget') return {};
      return {};
    },
  };
  return cdp;
}

function createMockContext(cdp) {
  return {
    newCDPSession: vi.fn().mockResolvedValue(cdp),
  };
}

function swTargetInfo({ id = 'sw-1', url = 'chrome-extension://abc/service-worker.js' } = {}) {
  return { type: 'service_worker', targetId: id, url, attached: true };
}

function popupTargetInfo({ id = 'popup-1', url = 'chrome-extension://abc/popup.html' } = {}) {
  return { type: 'page', targetId: id, url, attached: false };
}

function emitSessionMessage(cdp, sessionId, message) {
  cdp.emit('Target.receivedMessageFromTarget', {
    sessionId,
    message: JSON.stringify(message),
  });
}

describe('startExtensionCapture', () => {
  test('throws without context or page', async () => {
    await expect(startExtensionCapture({})).rejects.toThrow(/context is required/);
    await expect(startExtensionCapture({ context: {} })).rejects.toThrow(/page is required/);
  });

  test('attaches to existing service-worker target and enables Network', async () => {
    const cdp = createMockCdp({ existingTargets: [swTargetInfo()] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    // Allow the fire-and-forget attach to complete
    await new Promise((r) => setImmediate(r));

    const attaches = cdp.sent.filter((s) => s.method === 'Target.attachToTarget');
    expect(attaches).toHaveLength(1);
    expect(attaches[0].params.targetId).toBe('sw-1');
    expect(attaches[0].params.flatten).toBe(false);

    const enables = cdp.sent
      .filter((s) => s.method === 'Target.sendMessageToTarget')
      .map((s) => JSON.parse(s.params.message));
    expect(enables.some((m) => m.method === 'Network.enable')).toBe(true);

    await capture.stop();
  });

  test('skips non-extension targets', async () => {
    const nonExtPage = { type: 'page', targetId: 'p1', url: 'https://example.com/' };
    const cdp = createMockCdp({ existingTargets: [nonExtPage] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    const attaches = cdp.sent.filter((s) => s.method === 'Target.attachToTarget');
    expect(attaches).toHaveLength(0);

    await capture.stop();
  });

  test('attaches to popup pages too, not just service workers', async () => {
    const cdp = createMockCdp({ existingTargets: [popupTargetInfo()] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    const attaches = cdp.sent.filter((s) => s.method === 'Target.attachToTarget');
    expect(attaches).toHaveLength(1);
    expect(attaches[0].params.targetId).toBe('popup-1');

    await capture.stop();
  });

  test('does not double-attach to the same target', async () => {
    const target = swTargetInfo();
    const cdp = createMockCdp({ existingTargets: [target] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    // Fire targetCreated for the SAME target after startup
    cdp.emit('Target.targetCreated', { targetInfo: target });
    cdp.emit('Target.targetInfoChanged', { targetInfo: target });
    await new Promise((r) => setImmediate(r));

    const attaches = cdp.sent.filter((s) => s.method === 'Target.attachToTarget');
    expect(attaches).toHaveLength(1);

    await capture.stop();
  });

  test('captures Network events into entry on stop', async () => {
    const cdp = createMockCdp({ existingTargets: [swTargetInfo()] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    const sessionId = 'mock-session-1';

    // Drive a complete request lifecycle through the SW session
    emitSessionMessage(cdp, sessionId, {
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'req-1',
        wallTime: 1700000000.123,
        timestamp: 100,
        request: {
          method: 'POST',
          url: 'https://api.example.com/foo',
          postData: '{"a":1}',
        },
      },
    });
    emitSessionMessage(cdp, sessionId, {
      method: 'Network.responseReceived',
      params: {
        requestId: 'req-1',
        response: { status: 200, statusText: 'OK', mimeType: 'application/json' },
      },
    });
    emitSessionMessage(cdp, sessionId, {
      method: 'Network.loadingFinished',
      params: { requestId: 'req-1', timestamp: 100.245 },
    });
    // getResponseBody response comes back via the same channel
    await new Promise((r) => setImmediate(r));
    // Find the cmdId for the getResponseBody call
    const sendCalls = cdp.sent
      .filter((s) => s.method === 'Target.sendMessageToTarget')
      .map((s) => JSON.parse(s.params.message));
    const bodyCmd = sendCalls.find((m) => m.method === 'Network.getResponseBody');
    expect(bodyCmd).toBeDefined();
    emitSessionMessage(cdp, sessionId, {
      id: bodyCmd.id,
      result: { body: '{"ok":true}', base64Encoded: false },
    });

    const result = await capture.stop({ timeoutMs: 100 });
    expect(result.count).toBe(1);
    expect(result.entries[0]).toMatchObject({
      origin: 'service-worker',
      extensionId: 'abc',
      method: 'POST',
      url: 'https://api.example.com/foo',
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      requestBody: '{"a":1}',
      responseBody: '{"ok":true}',
      durationMs: 245,
      errorText: null,
    });
    expect(result.entries[0].startedDateTime).toMatch(/^\d{4}-/);
    // Internal fields are stripped
    expect(result.entries[0]._startTs).toBeUndefined();
    expect(result.entries[0]._sessionId).toBeUndefined();
  });

  test('marks failed requests', async () => {
    const cdp = createMockCdp({ existingTargets: [swTargetInfo()] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    const sessionId = 'mock-session-1';
    emitSessionMessage(cdp, sessionId, {
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'req-2',
        wallTime: 1700000001,
        timestamp: 200,
        request: { method: 'GET', url: 'https://api.example.com/will-fail' },
      },
    });
    emitSessionMessage(cdp, sessionId, {
      method: 'Network.loadingFailed',
      params: { requestId: 'req-2', errorText: 'net::ERR_FAILED' },
    });

    const result = await capture.stop({ timeoutMs: 50 });
    expect(result.count).toBe(1);
    expect(result.entries[0].errorText).toBe('net::ERR_FAILED');
    expect(result.entries[0].responseBody).toBe(null);
  });

  test('tags origin from page URL for popup target', async () => {
    const cdp = createMockCdp({ existingTargets: [popupTargetInfo()] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    emitSessionMessage(cdp, 'mock-session-1', {
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'req-3',
        wallTime: 1700000002,
        timestamp: 300,
        request: { method: 'GET', url: 'https://api.example.com/' },
      },
    });

    const result = await capture.stop({ timeoutMs: 50 });
    expect(result.entries[0].origin).toBe('popup');
  });

  test('treats chrome-extension index.html as popup origin', async () => {
    const target = popupTargetInfo({ url: 'chrome-extension://abc/index.html' });
    const cdp = createMockCdp({ existingTargets: [target] });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    emitSessionMessage(cdp, 'mock-session-1', {
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'req-4',
        wallTime: 1700000003,
        timestamp: 400,
        request: { method: 'GET', url: 'https://example.com/' },
      },
    });

    const result = await capture.stop({ timeoutMs: 50 });
    expect(result.entries[0].origin).toBe('popup');
  });

  test('runs sanitize callback over each entry', async () => {
    const cdp = createMockCdp({ existingTargets: [swTargetInfo()] });
    const ctx = createMockContext(cdp);
    const sanitize = (entry) => ({ ...entry, url: '[REDACTED]' });
    const capture = await startExtensionCapture({ context: ctx, page: {}, sanitize });
    await new Promise((r) => setImmediate(r));

    emitSessionMessage(cdp, 'mock-session-1', {
      method: 'Network.requestWillBeSent',
      params: {
        requestId: 'req-5',
        wallTime: 1700000004,
        timestamp: 500,
        request: { method: 'GET', url: 'https://api.example.com/secret?token=abc' },
      },
    });

    const result = await capture.stop({ timeoutMs: 50 });
    expect(result.entries[0].url).toBe('[REDACTED]');
  });

  test('returns sessionsAttached count in stop result', async () => {
    const cdp = createMockCdp({
      existingTargets: [swTargetInfo(), popupTargetInfo()],
    });
    const ctx = createMockContext(cdp);
    const capture = await startExtensionCapture({ context: ctx, page: {} });
    await new Promise((r) => setImmediate(r));

    const result = await capture.stop({ timeoutMs: 50 });
    expect(result.sessionsAttached).toBe(2);
  });
});
