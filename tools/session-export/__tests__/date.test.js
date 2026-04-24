import { test, expect } from 'vitest';
import { parseDateArg } from '../lib/date.js';

test('parses YYYY-MM-DD as local midnight by default', () => {
  const d = parseDateArg('2026-03-15');
  expect(d).toEqual(new Date(2026, 2, 15, 0, 0, 0, 0));
});

test('parses YYYY-MM-DD as end of day when endOfDay is true', () => {
  const d = parseDateArg('2026-03-15', { endOfDay: true });
  expect(d).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
});

test('parses YYYY-MM-DDTHH:MM:SS as exact local time', () => {
  const d = parseDateArg('2026-03-15T09:30:00');
  expect(d).toEqual(new Date(2026, 2, 15, 9, 30, 0));
});

test('endOfDay has no effect when time component is given', () => {
  const d = parseDateArg('2026-03-15T09:30:00', { endOfDay: true });
  expect(d).toEqual(new Date(2026, 2, 15, 9, 30, 0));
});

test('throws on invalid format', () => {
  expect(() => parseDateArg('March 15 2026')).toThrow('Invalid date');
  expect(() => parseDateArg('2026/03/15')).toThrow('Invalid date');
  expect(() => parseDateArg('15-03-2026')).toThrow('Invalid date');
});
