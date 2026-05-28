import { test, expect } from 'vitest';
import { resolvePorts } from '../ports.js';

// Fake get-port: returns the first port in the iterable not in `exclude`.
const fakeFindPort = async ({ port, exclude = [] }) => {
  for (const p of port) {
    if (!exclude.includes(p)) return p;
  }
  throw new Error('no free port');
};

test('explicit ports are used verbatim, without probing', async () => {
  let probed = false;
  const findPort = async () => { probed = true; return 1; };
  const r = await resolvePorts({ gateway: 8000, dashboard: 9000 }, ['gateway', 'dashboard'], { findPort });
  expect(r).toEqual({ gateway: 8000, dashboard: 9000 });
  expect(probed).toBe(false);
});

test('omitted ports auto-assign from the default range', async () => {
  const r = await resolvePorts({}, ['gateway', 'dashboard'], { findPort: fakeFindPort });
  expect(r).toEqual({ gateway: 8642, dashboard: 9119 });
});

test('a mix of explicit and omitted ports resolves both', async () => {
  const r = await resolvePorts({ gateway: 8000 }, ['gateway', 'dashboard'], { findPort: fakeFindPort });
  expect(r.gateway).toBe(8000);
  expect(r.dashboard).toBe(9119);
});

test('auto-assignment excludes explicitly-set ports', async () => {
  // gateway pinned to dashboard's default — dashboard must skip it.
  const r = await resolvePorts({ gateway: 9119 }, ['gateway', 'dashboard'], { findPort: fakeFindPort });
  expect(r.gateway).toBe(9119);
  expect(r.dashboard).toBe(9120);
});
