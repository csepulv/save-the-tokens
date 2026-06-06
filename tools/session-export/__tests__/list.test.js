import { test, expect } from 'vitest';
import { entriesToJson } from '../lib/commands/list.js';

const entry = (overrides = {}) => ({
  sessionId: '2bcd4ffb-6a5a-41b1-a9bc-13c28d9ad688',
  date: new Date('2026-06-02T01:55:28.515Z'),
  project: 'workspace/junkdrawer',
  encodedDir: '-Users-chris-workspace-junkdrawer',
  preview: 'jd-sync-fixes',
  ...overrides,
});

test('emits full ISO date (no minute truncation)', () => {
  const [row] = entriesToJson([entry()]);
  expect(row.date).toBe('2026-06-02T01:55:28.515Z');
  expect(row.sessionId).toBe('2bcd4ffb-6a5a-41b1-a9bc-13c28d9ad688');
  expect(row.project).toBe('workspace/junkdrawer');
  expect(row.preview).toBe('jd-sync-fixes');
  expect(row.encodedDir).toBe('-Users-chris-workspace-junkdrawer');
});

test('omits source key unless walking all sources', () => {
  const [row] = entriesToJson([entry()], { showSource: false });
  expect(row).not.toHaveProperty('source');
});

test('includes source when showSource is set', () => {
  const [row] = entriesToJson([entry({ sourceName: 'work' })], { showSource: true });
  expect(row.source).toBe('work');
});

test('passes through a string date unchanged', () => {
  const [row] = entriesToJson([entry({ date: '2026-06-02T01:55:28.515Z' })]);
  expect(row.date).toBe('2026-06-02T01:55:28.515Z');
});

test('null encodedDir tolerated', () => {
  const [row] = entriesToJson([entry({ encodedDir: undefined })]);
  expect(row.encodedDir).toBeNull();
});

test('empty input → empty array', () => {
  expect(entriesToJson([])).toEqual([]);
});
