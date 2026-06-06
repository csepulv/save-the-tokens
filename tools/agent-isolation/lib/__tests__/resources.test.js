import { test, expect } from 'vitest';
import { normalizeResources } from '../resources.js';

test('absent → null', () => {
  expect(normalizeResources(undefined)).toBeNull();
  expect(normalizeResources(null)).toBeNull();
});

test('normalizes cpus + memory', () => {
  expect(normalizeResources({ cpus: 2, memory: '4g' })).toEqual({ cpus: 2, memory: '4g' });
});

test('cpus only / memory only', () => {
  expect(normalizeResources({ cpus: 0.5 })).toEqual({ cpus: 0.5 });
  expect(normalizeResources({ memory: '512m' })).toEqual({ memory: '512m' });
});

test('accepts decimal memory and bare byte counts; trims', () => {
  expect(normalizeResources({ memory: '1.5g' })).toEqual({ memory: '1.5g' });
  expect(normalizeResources({ memory: '1073741824' })).toEqual({ memory: '1073741824' });
  expect(normalizeResources({ memory: ' 4g ' })).toEqual({ memory: '4g' });
});

test('numeric memory (bytes) is stringified', () => {
  expect(normalizeResources({ memory: 1024 })).toEqual({ memory: '1024' });
});

test('rejects a non-mapping resources', () => {
  expect(() => normalizeResources('nope')).toThrow(/resources/);
  expect(() => normalizeResources([1, 2])).toThrow(/resources/);
});

test('rejects an empty resources mapping', () => {
  expect(() => normalizeResources({})).toThrow(/at least one/);
});

test('rejects non-positive or non-numeric cpus', () => {
  expect(() => normalizeResources({ cpus: 0 })).toThrow(/cpus/);
  expect(() => normalizeResources({ cpus: -1 })).toThrow(/cpus/);
  expect(() => normalizeResources({ cpus: '2' })).toThrow(/cpus/);
});

test('rejects a malformed memory size', () => {
  expect(() => normalizeResources({ memory: 'lots' })).toThrow(/memory/);
  expect(() => normalizeResources({ memory: '4gigs' })).toThrow(/memory/);
});
