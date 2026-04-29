import { test, expect, describe, vi } from 'vitest';
import { correlateScreenshots, saveCorrelatedScreenshots } from '../correlate-screenshots.js';

function makeShot({ pageId, wallTime, savedPath }) {
  return {
    sha1: `${pageId}-${wallTime}.jpeg`,
    pageId,
    savedPath: savedPath || `/tmp/${pageId}-${wallTime}.jpeg`,
  };
}

function makeAction({ timestamp, pageId, url, type = 'click' }) {
  const action = { type, timestamp };
  if (pageId !== undefined) action.pageId = pageId;
  if (url !== undefined) action.url = url;
  return action;
}

describe('correlateScreenshots', () => {
  test('returns empty when no screenshots have wall times', () => {
    const screenshots = [{ sha1: 'malformed.jpeg' }];
    const actions = [makeAction({ timestamp: 1000 })];
    expect(correlateScreenshots(actions, screenshots)).toEqual([]);
  });

  test('matches each action to closest screenshot after it, within 3s', () => {
    const screenshots = [
      makeShot({ pageId: 'page@A', wallTime: 1100 }),
      makeShot({ pageId: 'page@A', wallTime: 2100 }),
    ];
    const actions = [
      makeAction({ timestamp: 1000 }),
      makeAction({ timestamp: 2000 }),
    ];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(2);
    expect(correlated[0].pageId).toBe('page@A');
    expect(correlated[0].actionIndex).toBe(1);
    expect(correlated[1].actionIndex).toBe(2);
  });

  test('skips actions without timestamp', () => {
    const screenshots = [makeShot({ pageId: 'page@A', wallTime: 1100 })];
    const actions = [makeAction({ timestamp: null })];
    expect(correlateScreenshots(actions, screenshots)).toEqual([]);
  });

  test('does not double-use the same screenshot', () => {
    // Two actions at same time, only one screenshot → only one match
    const screenshots = [makeShot({ pageId: 'page@A', wallTime: 1100 })];
    const actions = [
      makeAction({ timestamp: 1000 }),
      makeAction({ timestamp: 1010 }),
    ];
    expect(correlateScreenshots(actions, screenshots)).toHaveLength(1);
  });

  test('skips screenshots more than 3s after the action', () => {
    const screenshots = [makeShot({ pageId: 'page@A', wallTime: 5000 })];
    const actions = [makeAction({ timestamp: 1000 })];
    expect(correlateScreenshots(actions, screenshots)).toEqual([]);
  });

  // Page-aware matching

  test('prefers same-page screenshot even when another page is closer in time', () => {
    // Action on popup at t=1000. Screenshots: main page at 1100 (closer), popup at 1500.
    const screenshots = [
      makeShot({ pageId: 'page@MAIN', wallTime: 1100 }),
      makeShot({ pageId: 'page@POPUP', wallTime: 1500 }),
    ];
    const actions = [makeAction({ timestamp: 1000, pageId: 'page@POPUP' })];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(1);
    expect(correlated[0].pageId).toBe('page@POPUP');
  });

  test('falls back to any page when no same-page screenshot in window', () => {
    const screenshots = [makeShot({ pageId: 'page@MAIN', wallTime: 1100 })];
    const actions = [makeAction({ timestamp: 1000, pageId: 'page@POPUP' })];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(1);
    expect(correlated[0].pageId).toBe('page@MAIN');
  });

  test('action without pageId falls back to time-only matching', () => {
    const screenshots = [
      makeShot({ pageId: 'page@MAIN', wallTime: 1100 }),
      makeShot({ pageId: 'page@POPUP', wallTime: 1500 }),
    ];
    const actions = [makeAction({ timestamp: 1000 })];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(1);
    expect(correlated[0].pageId).toBe('page@MAIN');
  });

  test('attaches label from action.url to correlated screenshot', () => {
    const screenshots = [makeShot({ pageId: 'page@POPUP', wallTime: 1100 })];
    const actions = [
      makeAction({
        timestamp: 1000,
        pageId: 'page@POPUP',
        url: 'chrome-extension://abc/popup.html',
      }),
    ];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated[0].label).toBe('popup');
  });

  test('no label for regular https pages', () => {
    const screenshots = [makeShot({ pageId: 'page@A', wallTime: 1100 })];
    const actions = [
      makeAction({
        timestamp: 1000,
        pageId: 'page@A',
        url: 'https://example.com/',
      }),
    ];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated[0].label).toBe(null);
  });

  test('chrome-extension action without resolved pageId gets no Playwright shot', () => {
    // MV3 popups are caught at the CDP layer but Playwright never tracks
    // them as pages, so no frames exist for them. Don't fall back to
    // time-only matching — that would grab a misleading frame from the
    // main page.
    const screenshots = [makeShot({ pageId: 'page@MAIN', wallTime: 1100 })];
    const actions = [
      makeAction({
        timestamp: 1000,
        url: 'chrome-extension://abc/popup.html',
        // pageId NOT set — couldn't be resolved
      }),
    ];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(0);
  });

  test('chrome-extension action WITH resolved pageId still works (test fixture pages)', () => {
    // Some extension pages do surface as Playwright pages (e.g., when
    // navigated to directly via context.newPage() + goto). Those have a
    // resolved pageId and should correlate normally.
    const screenshots = [makeShot({ pageId: 'page@EXT', wallTime: 1100 })];
    const actions = [
      makeAction({
        timestamp: 1000,
        pageId: 'page@EXT',
        url: 'chrome-extension://abc/popup.html',
      }),
    ];
    const correlated = correlateScreenshots(actions, screenshots);
    expect(correlated).toHaveLength(1);
    expect(correlated[0].label).toBe('popup');
  });
});

describe('saveCorrelatedScreenshots', () => {
  test('writes filename with surface label when present', () => {
    const correlated = [
      { actionIndex: 1, pageId: 'page@MAIN', savedPath: '/tmp/x.jpeg', label: null },
      { actionIndex: 2, pageId: 'page@POPUP', savedPath: '/tmp/y.jpeg', label: 'popup' },
    ];
    const copyFile = vi.fn();
    const mkdir = vi.fn();
    const result = saveCorrelatedScreenshots(correlated, '/output/screenshots', {
      copyFileSync: copyFile,
      mkdirSync: mkdir,
    });
    expect(result[0].filename).toBe('action-01.jpeg');
    expect(result[1].filename).toBe('action-02-popup.jpeg');
    expect(mkdir).toHaveBeenCalledWith('/output/screenshots', { recursive: true });
    expect(copyFile).toHaveBeenCalledTimes(2);
  });
});
