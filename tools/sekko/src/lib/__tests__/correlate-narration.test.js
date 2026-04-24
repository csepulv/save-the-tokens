import { test, expect, describe } from 'vitest';
import { correlateNarration } from '../correlate-narration.js';

const AUDIO_START = 1000;

describe('correlateNarration', () => {
  test('matches narration segment to action within window', () => {
    const actions = [
      { type: 'click', timestamp: 1500, selector: '#btn' },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [
        { text: 'I click the button', startMs: 400, endMs: 1200 },
      ],
    };

    const result = correlateNarration(actions, narration);
    expect(result[0].narrationText).toBe('I click the button');
  });

  test('does not match segments outside the window', () => {
    const actions = [
      { type: 'click', timestamp: 1500, selector: '#btn' },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [
        { text: 'Much later', startMs: 5000, endMs: 6000 },
      ],
    };

    const result = correlateNarration(actions, narration);
    expect(result[0].narrationText).toBeUndefined();
  });

  test('matches multiple segments to one action', () => {
    const actions = [
      { type: 'click', timestamp: 2000, selector: '#btn' },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [
        { text: 'First part', startMs: 800, endMs: 1200 },
        { text: 'second part', startMs: 1200, endMs: 1800 },
      ],
    };

    const result = correlateNarration(actions, narration);
    expect(result[0].narrationText).toBe('First part second part');
  });

  test('handles actions without timestamps', () => {
    const actions = [
      { type: 'navigation', timestamp: null, selector: null },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [{ text: 'Hello', startMs: 0, endMs: 500 }],
    };

    const result = correlateNarration(actions, narration);
    expect(result[0].narrationText).toBeUndefined();
  });

  test('returns actions unchanged when no narration', () => {
    const actions = [{ type: 'click', timestamp: 1000, selector: '#btn' }];

    expect(correlateNarration(actions, null)).toEqual(actions);
    expect(correlateNarration(actions, { segments: [] })).toEqual(actions);
    expect(correlateNarration(actions, undefined)).toEqual(actions);
  });

  test('preserves existing action properties', () => {
    const actions = [
      { type: 'click', timestamp: 1500, selector: '#btn', requestIds: [1, 2] },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [{ text: 'Click here', startMs: 400, endMs: 800 }],
    };

    const result = correlateNarration(actions, narration);
    expect(result[0].type).toBe('click');
    expect(result[0].selector).toBe('#btn');
    expect(result[0].requestIds).toEqual([1, 2]);
    expect(result[0].narrationText).toBe('Click here');
  });

  test('uses custom window size', () => {
    const actions = [
      { type: 'click', timestamp: 2000, selector: '#btn' },
    ];
    const narration = {
      audioStartEpoch: AUDIO_START,
      segments: [{ text: 'Nearby', startMs: 500, endMs: 800 }],
    };

    // Default window (2000ms) — segment wall-clock is 1500, action is 2000, delta is 500 → match
    expect(correlateNarration(actions, narration)[0].narrationText).toBe('Nearby');

    // Tight window (100ms) — delta 500 → no match
    expect(correlateNarration(actions, narration, 100)[0].narrationText).toBeUndefined();
  });
});
