import { test, expect, describe, vi } from 'vitest';
import { listSystemScreenshots, correlateSystemScreenshots } from '../correlate-system-screenshots.js';

describe('listSystemScreenshots', () => {
  test('returns empty when source dir does not exist', () => {
    const deps = { exists: () => false, readdir: vi.fn() };
    expect(listSystemScreenshots('/missing', deps)).toEqual([]);
    expect(deps.readdir).not.toHaveBeenCalled();
  });

  test('parses epoch from filename and sorts by time', () => {
    const deps = {
      exists: () => true,
      readdir: () => ['screen-3000.jpg', 'screen-1000.jpg', 'screen-2000.jpg'],
    };
    const result = listSystemScreenshots('/dir', deps);
    expect(result.map((s) => s.wallTime)).toEqual([1000, 2000, 3000]);
    expect(result[0].sourcePath).toBe('/dir/screen-1000.jpg');
  });

  test('accepts both .jpg and .jpeg extensions', () => {
    const deps = {
      exists: () => true,
      readdir: () => ['screen-1.jpg', 'screen-2.jpeg', 'screen-3.JPG'],
    };
    const result = listSystemScreenshots('/dir', deps);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.filename)).toEqual(['screen-1.jpg', 'screen-2.jpeg']);
  });

  test('ignores non-matching files', () => {
    const deps = {
      exists: () => true,
      readdir: () => ['screen-100.jpg', 'random.jpg', 'screen-malformed.jpg', '.DS_Store'],
    };
    const result = listSystemScreenshots('/dir', deps);
    expect(result.map((s) => s.filename)).toEqual(['screen-100.jpg']);
  });
});

describe('correlateSystemScreenshots', () => {
  function shot(wallTime) {
    return { filename: `screen-${wallTime}.jpg`, wallTime, sourcePath: `/d/screen-${wallTime}.jpg` };
  }

  test('returns empty when no actions', () => {
    const result = correlateSystemScreenshots([], [shot(1000), shot(2000)]);
    expect(result).toEqual([]);
  });

  test('returns empty when no screenshots', () => {
    const result = correlateSystemScreenshots([{ timestamp: 1000 }], []);
    expect(result).toEqual([]);
  });

  test('prefers closest-AFTER over closest-before', () => {
    // Action at 1100. Frame at 1000 (-100ms, before). Frame at 1500 (+400ms, after).
    // Closest absolute would pick 1000, but closest-after picks 1500 because
    // we want the post-action state (e.g., popup just rendered).
    const actions = [{ timestamp: 1100, type: 'click' }];
    const shots = [shot(1000), shot(1500), shot(2000)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(1);
    expect(result[0].wallTime).toBe(1500);
    expect(result[0].actionIndex).toBe(1);
  });

  test('falls back to closest-before when no AFTER frame in window', () => {
    // Action at 5000. Only frame at 4500 (-500ms, before). No after-frame.
    // Should still match (the before-frame is closer than the empty alternative).
    const actions = [{ timestamp: 5000, type: 'click' }];
    const shots = [shot(4500)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(1);
    expect(result[0].wallTime).toBe(4500);
  });

  test('skips screenshots outside the time window', () => {
    const actions = [{ timestamp: 5000 }];
    const shots = [shot(1000)];
    const result = correlateSystemScreenshots(actions, shots, 1500);
    expect(result).toEqual([]);
  });

  test('does not reuse the same screenshot for two actions', () => {
    const actions = [
      { timestamp: 1000, type: 'click' },
      { timestamp: 1100, type: 'click' },
    ];
    const shots = [shot(1050)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(1);
    // First action gets the shot (closer-after: +50ms vs -50ms for second)
    expect(result[0].actionIndex).toBe(1);
  });

  test('attaches surface label from action url', () => {
    const actions = [
      { timestamp: 1000, url: 'chrome-extension://abc/index.html', type: 'page-opened' },
    ];
    const shots = [shot(1100)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('popup');
  });

  test('skips actions without timestamp', () => {
    const actions = [{ timestamp: null, type: 'navigation' }];
    const shots = [shot(1000)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toEqual([]);
  });

  test('matches multiple actions to multiple shots', () => {
    const actions = [
      { timestamp: 1000, type: 'click' },
      { timestamp: 2000, type: 'page-opened' },
      { timestamp: 3000, type: 'click' },
    ];
    const shots = [shot(1000), shot(2000), shot(3000), shot(4000)];
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.actionIndex)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.wallTime)).toEqual([1000, 2000, 3000]);
  });

  test('window of 1500ms tolerates clock skew', () => {
    const actions = [{ timestamp: 5000 }];
    const shots = [shot(6400)]; // 1400ms after action — within 1500ms
    const result = correlateSystemScreenshots(actions, shots);
    expect(result).toHaveLength(1);
  });
});
