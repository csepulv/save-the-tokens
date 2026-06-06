// Ported from the former tools/hermes/lib/__tests__/workspace.test.js (M3a), sync.
import { test, expect } from 'vitest';
import { ensureWorkspace } from '../workspace.js';

test('ensureWorkspace creates the hermes and claude-code dirs under the root', () => {
  const calls = [];
  const mkdir = (path, opts) => { calls.push({ path, opts }); };
  const result = ensureWorkspace('/tmp/ws', { mkdir });
  expect(result).toEqual({ hermesDir: '/tmp/ws/hermes', claudeDir: '/tmp/ws/claude-code' });
  expect(calls).toEqual([
    { path: '/tmp/ws/hermes', opts: { recursive: true } },
    { path: '/tmp/ws/claude-code', opts: { recursive: true } },
  ]);
});
