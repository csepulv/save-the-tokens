import { test, expect, describe } from 'vitest';
import { pairActions, extractSelectors } from '../parse-actions.js';

describe('pairActions', () => {
  test('pairs before/after events by callId', () => {
    const events = [
      { type: 'before', callId: 'call@1', class: 'Frame', method: 'goto', params: { url: 'https://example.com' }, startTime: 100 },
      { type: 'after', callId: 'call@1', endTime: 200 },
    ];

    const actions = pairActions(events);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      callId: 'call@1',
      class: 'Frame',
      method: 'goto',
      params: { url: 'https://example.com' },
      startTime: 100,
      endTime: 200,
      selector: null,
    });
  });

  test('extracts selector from click actions', () => {
    const events = [
      { type: 'before', callId: 'call@2', class: 'Frame', method: 'click', params: { selector: 'button#submit' }, startTime: 300 },
      { type: 'after', callId: 'call@2', endTime: 350 },
    ];

    const actions = pairActions(events);
    expect(actions[0].selector).toBe('button#submit');
  });

  test('handles multiple actions in order', () => {
    const events = [
      { type: 'before', callId: 'call@1', class: 'BrowserContext', method: 'newPage', params: {}, startTime: 0 },
      { type: 'after', callId: 'call@1', endTime: 50 },
      { type: 'before', callId: 'call@2', class: 'Frame', method: 'goto', params: { url: 'https://example.com' }, startTime: 60 },
      { type: 'after', callId: 'call@2', endTime: 200 },
      { type: 'before', callId: 'call@3', class: 'Frame', method: 'click', params: { selector: 'a' }, startTime: 300 },
      { type: 'after', callId: 'call@3', endTime: 400 },
    ];

    const actions = pairActions(events);
    expect(actions).toHaveLength(3);
    expect(actions[0].method).toBe('newPage');
    expect(actions[1].method).toBe('goto');
    expect(actions[2].method).toBe('click');
  });

  test('ignores non-action events', () => {
    const events = [
      { type: 'context-options', browserName: 'chromium' },
      { type: 'event', class: 'BrowserContext', method: 'page', params: {} },
      { type: 'screencast-frame', timestamp: 100 },
      { type: 'before', callId: 'call@1', class: 'Frame', method: 'goto', params: { url: 'https://example.com' }, startTime: 0 },
      { type: 'after', callId: 'call@1', endTime: 100 },
    ];

    const actions = pairActions(events);
    expect(actions).toHaveLength(1);
  });

  test('skips orphaned after events', () => {
    const events = [
      { type: 'after', callId: 'call@99', endTime: 100 },
    ];

    const actions = pairActions(events);
    expect(actions).toHaveLength(0);
  });

  test('returns empty array for no action events', () => {
    const events = [
      { type: 'context-options', browserName: 'chromium' },
      { type: 'screencast-frame', timestamp: 100 },
    ];

    const actions = pairActions(events);
    expect(actions).toHaveLength(0);
  });
});

describe('extractSelectors', () => {
  test('extracts unique selectors from actions', () => {
    const actions = [
      { selector: 'button#submit' },
      { selector: 'input[name="email"]' },
      { selector: 'button#submit' },
      { selector: null },
    ];

    const selectors = extractSelectors(actions);
    expect(selectors).toEqual(['button#submit', 'input[name="email"]']);
  });

  test('returns empty array when no selectors', () => {
    const actions = [{ selector: null }, { selector: null }];
    expect(extractSelectors(actions)).toEqual([]);
  });
});
