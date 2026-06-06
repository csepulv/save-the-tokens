// Adapted from the former tools/hermes/lib/__tests__/ports.test.js (M3a): sync `free`
// predicate (isPortFree-shaped) instead of async get-port.
import { test, expect } from 'vitest';
import { resolvePorts } from '../ports.js';

test('explicit ports are used verbatim, without probing', () => {
  let probed = false;
  const free = () => { probed = true; return true; };
  const r = resolvePorts({ gateway: 8000, dashboard: 9000 }, ['gateway', 'dashboard'], { free });
  expect(r).toEqual({ gateway: 8000, dashboard: 9000 });
  expect(probed).toBe(false);
});

test('omitted ports auto-assign from the default range', () => {
  const r = resolvePorts({}, ['gateway', 'dashboard'], { free: () => true });
  expect(r).toEqual({ gateway: 8642, dashboard: 9119 });
});

test('a mix of explicit and omitted ports resolves both', () => {
  const r = resolvePorts({ gateway: 8000 }, ['gateway', 'dashboard'], { free: () => true });
  expect(r.gateway).toBe(8000);
  expect(r.dashboard).toBe(9119);
});

test('auto-assignment excludes explicitly-set ports', () => {
  // gateway pinned to dashboard's default — dashboard must skip it.
  const r = resolvePorts({ gateway: 9119 }, ['gateway', 'dashboard'], { free: () => true });
  expect(r.gateway).toBe(9119);
  expect(r.dashboard).toBe(9120);
});

test('ssh key resolves from its own default when requested', () => {
  const r = resolvePorts({}, ['gateway', 'dashboard', 'ssh'], { free: () => true });
  expect(r).toEqual({ gateway: 8642, dashboard: 9119, ssh: 2222 });
});
