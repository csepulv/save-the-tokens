import { test, expect, describe, vi } from 'vitest';
import { buildPageHistory, buildPageHistoryFromTraceDir, resolvePageId } from '../build-page-map.js';

function snapshot({ pageId, url, wallTime, isMainFrame = true }) {
  return JSON.stringify({
    type: 'frame-snapshot',
    snapshot: { pageId, frameUrl: url, wallTime, isMainFrame, html: ['HTML'] },
  });
}

describe('buildPageHistory', () => {
  test('returns empty for empty input', () => {
    expect(buildPageHistory('')).toEqual([]);
    expect(buildPageHistory(null)).toEqual([]);
  });

  test('extracts pageId/url/wallTime from main-frame snapshots', () => {
    const trace = [
      snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 }),
      snapshot({ pageId: 'page@B', url: 'chrome-extension://x/popup.html', wallTime: 2000 }),
    ].join('\n');

    const history = buildPageHistory(trace);
    expect(history).toEqual([
      { pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 },
      { pageId: 'page@B', url: 'chrome-extension://x/popup.html', wallTime: 2000 },
    ]);
  });

  test('skips about:blank entries', () => {
    const trace = [
      snapshot({ pageId: 'page@A', url: 'about:blank', wallTime: 500 }),
      snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 }),
    ].join('\n');
    const history = buildPageHistory(trace);
    expect(history).toHaveLength(1);
    expect(history[0].url).toBe('https://example.com/');
  });

  test('skips non-main-frame snapshots (iframes)', () => {
    const trace = [
      snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 }),
      snapshot({ pageId: 'page@A', url: 'https://iframe.example/', wallTime: 1100, isMainFrame: false }),
    ].join('\n');
    const history = buildPageHistory(trace);
    expect(history).toHaveLength(1);
    expect(history[0].url).toBe('https://example.com/');
  });

  test('ignores other event types', () => {
    const trace = [
      snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 }),
      JSON.stringify({ type: 'before', pageId: 'page@B' }),
      JSON.stringify({ type: 'screencast-frame', pageId: 'page@A' }),
    ].join('\n');
    const history = buildPageHistory(trace);
    expect(history).toHaveLength(1);
  });

  test('skips malformed JSON lines', () => {
    const trace = [
      'not json',
      snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 }),
      '{partial',
    ].join('\n');
    const history = buildPageHistory(trace);
    expect(history).toHaveLength(1);
  });

  test('sorts entries by wallTime ascending', () => {
    const trace = [
      snapshot({ pageId: 'page@C', url: 'https://c/', wallTime: 3000 }),
      snapshot({ pageId: 'page@A', url: 'https://a/', wallTime: 1000 }),
      snapshot({ pageId: 'page@B', url: 'https://b/', wallTime: 2000 }),
    ].join('\n');
    const history = buildPageHistory(trace);
    expect(history.map((e) => e.url)).toEqual(['https://a/', 'https://b/', 'https://c/']);
  });
});

describe('buildPageHistoryFromTraceDir', () => {
  test('reads trace.trace and parses', () => {
    const trace = snapshot({ pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 });
    const deps = {
      readFileSync: vi.fn().mockReturnValue(trace),
    };
    const history = buildPageHistoryFromTraceDir('/some/dir', deps);
    expect(history).toHaveLength(1);
    expect(deps.readFileSync).toHaveBeenCalledWith('/some/dir/trace.trace', 'utf-8');
  });

  test('returns empty when trace.trace is missing', () => {
    const deps = {
      readFileSync: vi.fn().mockImplementation(() => {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      }),
    };
    expect(buildPageHistoryFromTraceDir('/missing', deps)).toEqual([]);
  });

  test('rethrows non-ENOENT errors', () => {
    const deps = {
      readFileSync: vi.fn().mockImplementation(() => {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' });
      }),
    };
    expect(() => buildPageHistoryFromTraceDir('/locked', deps)).toThrow(/access denied/);
  });
});

describe('resolvePageId', () => {
  const history = [
    { pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 },
    { pageId: 'page@B', url: 'chrome-extension://x/popup.html', wallTime: 2000 },
    { pageId: 'page@A', url: 'https://example.com/page2', wallTime: 3000 },
  ];

  test('returns matching pageId at the action time', () => {
    expect(resolvePageId(history, 'https://example.com/', 1500)).toBe('page@A');
    expect(resolvePageId(history, 'chrome-extension://x/popup.html', 2500)).toBe('page@B');
    expect(resolvePageId(history, 'https://example.com/page2', 3500)).toBe('page@A');
  });

  test('returns null for unknown URL', () => {
    expect(resolvePageId(history, 'https://unknown.example/', 1500)).toBe(null);
  });

  test('returns null for null inputs', () => {
    expect(resolvePageId(history, null, 1500)).toBe(null);
    expect(resolvePageId(history, 'https://example.com/', null)).toBe(null);
    expect(resolvePageId([], 'https://example.com/', 1500)).toBe(null);
  });

  test('does not resolve to entries far in the future', () => {
    expect(resolvePageId(history, 'chrome-extension://x/popup.html', 100)).toBe(null);
  });

  test('honors small forward tolerance for clock skew', () => {
    // Entry at wallTime 2000; action at 1900. With 1500ms tolerance, matches.
    expect(resolvePageId(history, 'chrome-extension://x/popup.html', 1900)).toBe('page@B');
  });

  test('picks latest matching entry when multiple', () => {
    const history = [
      { pageId: 'page@A', url: 'https://example.com/', wallTime: 1000 },
      { pageId: 'page@B', url: 'https://example.com/', wallTime: 5000 }, // popup re-opened
    ];
    expect(resolvePageId(history, 'https://example.com/', 6000)).toBe('page@B');
    expect(resolvePageId(history, 'https://example.com/', 1500)).toBe('page@A');
  });
});
