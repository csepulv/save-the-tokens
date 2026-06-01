import { test, expect } from 'vitest';
import { parsePublishedHostPorts, resolveOauthHostPort, nextFreePort, resolveExtraPorts } from '../ports.js';

test('parsePublishedHostPorts extracts host ports from docker ps output', () => {
  const out = '0.0.0.0:3118->3118/tcp, :::3118->3118/tcp\n0.0.0.0:5173->5173/tcp';
  expect(parsePublishedHostPorts(out)).toEqual(new Set([3118, 5173]));
});

test('parsePublishedHostPorts returns an empty set for no published ports', () => {
  expect(parsePublishedHostPorts('')).toEqual(new Set());
});

test('resolveOauthHostPort returns the start port when free', () => {
  expect(resolveOauthHostPort(new Set(), 3118)).toBe(3118);
});

test('resolveOauthHostPort increments past published ports', () => {
  expect(resolveOauthHostPort(new Set([3118]), 3118)).toBe(3119);
  expect(resolveOauthHostPort(new Set([3118, 3119]), 3118)).toBe(3120);
});

test('nextFreePort returns the first port the predicate reports free', () => {
  const busy = new Set([4000, 4001]);
  expect(nextFreePort(4000, (p) => !busy.has(p))).toBe(4002);
  expect(nextFreePort(4000, () => true)).toBe(4000);
});

test('resolveExtraPorts passes free ports through untouched', () => {
  const ports = resolveExtraPorts(['5173:5173', '8080:80'], { free: () => true });
  expect(ports).toEqual(['5173:5173', '8080:80']);
});

test('resolveExtraPorts remaps the host side when the user accepts', () => {
  const ports = resolveExtraPorts(['4000:4000'], {
    free: (p) => p !== 4000, // 4000 busy, 4001 free
    prompt: () => 'y',
    log: () => {},
  });
  expect(ports).toEqual(['4001:4000']); // host remapped, container preserved
});

test('resolveExtraPorts throws when the conflict is declined (bare Enter)', () => {
  expect(() =>
    resolveExtraPorts(['4000:4000'], { free: (p) => p !== 4000, prompt: () => '' }),
  ).toThrow(/Port 4000 is in use/);
});
