import { test, expect, describe } from 'vitest';
import { correlateActionAndNetworkCalls } from '../correlate.js';

describe('correlateActionAndNetworkCalls', () => {
  test('matches network request to closest preceding action within window', () => {
    const actions = [
      { type: 'click', timestamp: 1000, selector: '#btn' },
    ];
    const network = [
      { id: 1, startedDateTime: '2026-01-01T00:00:01.500Z', method: 'POST', url: '/api' },
    ];
    // action at epoch 1000, network at epoch of the ISO string
    // Use matching timestamps
    const actionTime = new Date('2026-01-01T00:00:01.000Z').getTime();
    const actions2 = [{ type: 'click', timestamp: actionTime, selector: '#btn' }];

    const result = correlateActionAndNetworkCalls(actions2, network);
    expect(result.network[0].actionIndex).toBe(1);
    expect(result.actions[0].requestIds).toEqual([1]);
  });

  test('does not match requests outside the window', () => {
    const actionTime = new Date('2026-01-01T00:00:01.000Z').getTime();
    const actions = [{ type: 'click', timestamp: actionTime, selector: '#btn' }];
    const network = [
      { id: 1, startedDateTime: '2026-01-01T00:00:05.000Z', method: 'GET', url: '/late' },
    ];

    const result = correlateActionAndNetworkCalls(actions, network, 2000);
    expect(result.network[0].actionIndex).toBeNull();
    expect(result.actions[0].requestIds).toEqual([]);
  });

  test('matches multiple requests to one action', () => {
    const actionTime = new Date('2026-01-01T00:00:01.000Z').getTime();
    const actions = [{ type: 'click', timestamp: actionTime, selector: '#btn' }];
    const network = [
      { id: 1, startedDateTime: '2026-01-01T00:00:01.100Z', method: 'POST', url: '/a' },
      { id: 2, startedDateTime: '2026-01-01T00:00:01.200Z', method: 'POST', url: '/b' },
      { id: 3, startedDateTime: '2026-01-01T00:00:01.300Z', method: 'POST', url: '/c' },
    ];

    const result = correlateActionAndNetworkCalls(actions, network);
    expect(result.actions[0].requestIds).toEqual([1, 2, 3]);
    expect(result.network.every((e) => e.actionIndex === 1)).toBe(true);
  });

  test('matches to most recent action when multiple are in window', () => {
    const t1 = new Date('2026-01-01T00:00:01.000Z').getTime();
    const t2 = new Date('2026-01-01T00:00:02.000Z').getTime();
    const actions = [
      { type: 'click', timestamp: t1, selector: '#a' },
      { type: 'click', timestamp: t2, selector: '#b' },
    ];
    const network = [
      { id: 1, startedDateTime: '2026-01-01T00:00:02.500Z', method: 'GET', url: '/data' },
    ];

    const result = correlateActionAndNetworkCalls(actions, network);
    // Should match action #2 (most recent within window)
    expect(result.network[0].actionIndex).toBe(2);
    expect(result.actions[0].requestIds).toEqual([]);
    expect(result.actions[1].requestIds).toEqual([1]);
  });

  test('handles actions with no timestamp', () => {
    const actions = [{ type: 'navigation', timestamp: null, selector: null }];
    const network = [
      { id: 1, startedDateTime: '2026-01-01T00:00:01.000Z', method: 'GET', url: '/data' },
    ];

    const result = correlateActionAndNetworkCalls(actions, network);
    expect(result.network[0].actionIndex).toBeNull();
  });

  test('handles empty inputs', () => {
    const result = correlateActionAndNetworkCalls([], []);
    expect(result.actions).toEqual([]);
    expect(result.network).toEqual([]);
  });

  test('service-worker entries are not correlated to user actions', () => {
    const actionTime = new Date('2026-01-01T00:00:01.000Z').getTime();
    const actions = [{ type: 'click', timestamp: actionTime, selector: '#btn' }];
    const network = [
      // Page entry — should correlate
      {
        id: 1,
        origin: 'page',
        startedDateTime: '2026-01-01T00:00:01.500Z',
        method: 'POST',
        url: '/api/page',
      },
      // SW entry within the same window — should NOT correlate
      {
        id: 2,
        origin: 'service-worker',
        startedDateTime: '2026-01-01T00:00:01.500Z',
        method: 'GET',
        url: '/api/sw',
      },
    ];

    const result = correlateActionAndNetworkCalls(actions, network);

    expect(result.network[0].actionIndex).toBe(1);    // page → matched
    expect(result.network[1].actionIndex).toBe(null); // SW → null
    expect(result.actions[0].requestIds).toEqual([1]); // SW NOT in requestIds
  });

  test('popup entries do correlate (only SW is excluded)', () => {
    const actionTime = new Date('2026-01-01T00:00:01.000Z').getTime();
    const actions = [{ type: 'click', timestamp: actionTime, selector: '#btn' }];
    const network = [
      {
        id: 1,
        origin: 'popup',
        startedDateTime: '2026-01-01T00:00:01.500Z',
        method: 'POST',
        url: '/api/popup',
      },
    ];

    const result = correlateActionAndNetworkCalls(actions, network);
    expect(result.network[0].actionIndex).toBe(1);
    expect(result.actions[0].requestIds).toEqual([1]);
  });
});
