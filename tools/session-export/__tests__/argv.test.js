import { test, expect } from 'vitest';
import { extractOptionalFlag } from '../lib/argv.js';

test('returns undefined when flag is not present', () => {
  const { value, remaining } = extractOptionalFlag(['--list', 'abc'], '--output');
  expect(value).toBeUndefined();
  expect(remaining).toEqual(['--list', 'abc']);
});

test('returns true when flag has no following argument', () => {
  const { value, remaining } = extractOptionalFlag(['--output', '--list'], '--output');
  expect(value).toBe(true);
  expect(remaining).toEqual(['--list']);
});

test('returns true when flag is last argument', () => {
  const { value, remaining } = extractOptionalFlag(['abc', '--output'], '--output');
  expect(value).toBe(true);
  expect(remaining).toEqual(['abc']);
});

test('returns string value when followed by non-flag argument', () => {
  const { value, remaining } = extractOptionalFlag(['--output', 'file.md', 'abc'], '--output');
  expect(value).toBe('file.md');
  expect(remaining).toEqual(['abc']);
});

test('treats argument starting with dash as a separate flag', () => {
  const { value, remaining } = extractOptionalFlag(['--output', '--format', 'md'], '--output');
  expect(value).toBe(true);
  expect(remaining).toEqual(['--format', 'md']);
});

test('does not mutate original argv', () => {
  const argv = ['--output', 'file.md', '--list'];
  extractOptionalFlag(argv, '--output');
  expect(argv).toEqual(['--output', 'file.md', '--list']);
});

test('handles flag in middle of argv with value', () => {
  const { value, remaining } = extractOptionalFlag(
    ['--include-all', '--output', '/tmp/out/', 'abc123'],
    '--output',
  );
  expect(value).toBe('/tmp/out/');
  expect(remaining).toEqual(['--include-all', 'abc123']);
});
