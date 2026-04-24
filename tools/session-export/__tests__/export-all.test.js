import { test, expect } from 'vitest';
import {
  groupByProject,
  filterProjects,
  buildFlatNames,
  slugifyPath,
  uniqueSlug,
  filterByDate,
} from '../lib/export-all.js';

// --- groupByProject ---

test('groups entries by project name', () => {
  const entries = [
    { project: 'workspace/foo', sessionId: '1' },
    { project: 'workspace/bar', sessionId: '2' },
    { project: 'workspace/foo', sessionId: '3' },
  ];
  const result = groupByProject(entries);
  expect(result.get('workspace/foo')).toHaveLength(2);
  expect(result.get('workspace/bar')).toHaveLength(1);
});

test('groups entries with no project under (unknown)', () => {
  const entries = [
    { project: '', sessionId: '1' },
    { project: null, sessionId: '2' },
  ];
  const result = groupByProject(entries);
  expect(result.get('(unknown)')).toHaveLength(2);
});

// --- filterProjects ---

test('returns all projects when no filter given', () => {
  const map = new Map([
    ['workspace/foo', []],
    ['workspace/bar', []],
  ]);
  expect(filterProjects(map, null).size).toBe(2);
  expect(filterProjects(map, undefined).size).toBe(2);
});

test('filters projects by substring (case insensitive)', () => {
  const map = new Map([
    ['workspace/my-tools', []],
    ['workspace/michi', []],
    ['personal/notes', []],
  ]);
  const result = filterProjects(map, 'workspace');
  expect(result.size).toBe(2);
  expect(result.has('workspace/my-tools')).toBe(true);
  expect(result.has('workspace/michi')).toBe(true);
});

test('filter match is case insensitive', () => {
  const map = new Map([['workspace/My-Tools', []]]);
  expect(filterProjects(map, 'my-tools').size).toBe(1);
});

test('returns empty map when nothing matches', () => {
  const map = new Map([['workspace/foo', []]]);
  expect(filterProjects(map, 'zzz').size).toBe(0);
});

// --- buildFlatNames ---

test('uses basename as folder name', () => {
  const map = new Map([['workspace/my-tools', []]]);
  const names = buildFlatNames(map);
  expect(names.get('workspace/my-tools')).toBe('my-tools');
});

test('single-segment project path uses path as-is', () => {
  const map = new Map([['my-project', []]]);
  const names = buildFlatNames(map);
  expect(names.get('my-project')).toBe('my-project');
});

test('disambiguates colliding basenames with full slugified path', () => {
  const map = new Map([
    ['workspace/utils', []],
    ['personal/utils', []],
  ]);
  const names = buildFlatNames(map);
  expect(names.get('workspace/utils')).toBe('workspace-utils');
  expect(names.get('personal/utils')).toBe('personal-utils');
});

test('non-colliding entries keep their basename', () => {
  const map = new Map([
    ['workspace/foo', []],
    ['workspace/bar', []],
  ]);
  const names = buildFlatNames(map);
  expect(names.get('workspace/foo')).toBe('foo');
  expect(names.get('workspace/bar')).toBe('bar');
});

// --- slugifyPath ---

test('replaces slashes with dashes', () => {
  expect(slugifyPath('workspace/michi')).toBe('workspace-michi');
});

// --- uniqueSlug ---

test('returns slug unchanged when not used', () => {
  const used = new Set();
  expect(uniqueSlug('my-session', 'abcd1234-efgh', used)).toBe('my-session');
});

test('appends first 8 chars of session ID on collision', () => {
  const used = new Set(['my-session']);
  expect(uniqueSlug('my-session', 'abcd1234-efgh', used)).toBe('my-session-abcd1234');
});

// --- filterByDate ---

function makeEntry(isoDate) {
  return { date: new Date(isoDate), sessionId: isoDate };
}

test('returns all entries when no bounds given', () => {
  const entries = [makeEntry('2026-01-01'), makeEntry('2026-06-01')];
  expect(filterByDate(entries, null, null)).toHaveLength(2);
});

test('filters entries before afterDate', () => {
  const entries = [
    makeEntry('2026-01-01T00:00:00'),
    makeEntry('2026-03-01T00:00:00'),
    makeEntry('2026-06-01T00:00:00'),
  ];
  const after = new Date(2026, 1, 15); // Feb 15
  const result = filterByDate(entries, after, null);
  expect(result).toHaveLength(2);
  expect(result[0].sessionId).toBe('2026-03-01T00:00:00');
  expect(result[1].sessionId).toBe('2026-06-01T00:00:00');
});

test('filters entries after beforeDate', () => {
  const entries = [
    makeEntry('2026-01-01T00:00:00'),
    makeEntry('2026-03-01T00:00:00'),
    makeEntry('2026-06-01T00:00:00'),
  ];
  const before = new Date(2026, 2, 31, 23, 59, 59, 999); // end of Mar 31
  const result = filterByDate(entries, null, before);
  expect(result).toHaveLength(2);
  expect(result[0].sessionId).toBe('2026-01-01T00:00:00');
  expect(result[1].sessionId).toBe('2026-03-01T00:00:00');
});

test('applies both bounds together', () => {
  const entries = [
    makeEntry('2026-01-01T00:00:00'),
    makeEntry('2026-03-01T00:00:00'),
    makeEntry('2026-06-01T00:00:00'),
  ];
  const after = new Date(2026, 1, 1);  // Feb 1
  const before = new Date(2026, 3, 30, 23, 59, 59, 999); // Apr 30
  const result = filterByDate(entries, after, before);
  expect(result).toHaveLength(1);
  expect(result[0].sessionId).toBe('2026-03-01T00:00:00');
});

test('afterDate bound is inclusive', () => {
  const exactDate = new Date(2026, 2, 15, 0, 0, 0, 0);
  const entries = [{ date: exactDate, sessionId: 'exact' }];
  expect(filterByDate(entries, exactDate, null)).toHaveLength(1);
});

test('beforeDate bound is inclusive', () => {
  const exactDate = new Date(2026, 2, 15, 23, 59, 59, 999);
  const entries = [{ date: exactDate, sessionId: 'exact' }];
  expect(filterByDate(entries, null, exactDate)).toHaveLength(1);
});
