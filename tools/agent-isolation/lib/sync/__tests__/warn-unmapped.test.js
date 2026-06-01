import { test, expect } from 'vitest';
import { firstUnmappedHomePath } from '../warn-unmapped.js';

const HOME = '/Users/test';

test('returns the first home path, stopping at a quote', () => {
  const text = '{"installPath":"/Users/test/.claude/plugins/x","other":1}';
  expect(firstUnmappedHomePath(text, HOME)).toBe('/Users/test/.claude/plugins/x');
});

test('returns null when no home path remains', () => {
  const text = '{"installPath":"/home/agent/.claude/plugins/x"}';
  expect(firstUnmappedHomePath(text, HOME)).toBeNull();
});

test('escapes regex-special characters in the home path', () => {
  const text = '{"p":"/Users/test/a.b/c"}';
  expect(firstUnmappedHomePath(text, '/Users/test/a.b')).toBe('/Users/test/a.b/c');
});
