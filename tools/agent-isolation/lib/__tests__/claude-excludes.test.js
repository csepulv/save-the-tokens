import { test, expect } from 'vitest';
import { ALWAYS_EXCLUDE, SESSION_EXCLUDE } from '../claude-excludes.js';

test('ALWAYS_EXCLUDE holds the secret/ephemeral set; not /settings.json (interactive-only)', () => {
  expect(ALWAYS_EXCLUDE).toContain('.credentials.json');
  expect(ALWAYS_EXCLUDE).toContain('__store.db');
  expect(ALWAYS_EXCLUDE).toContain('shell-snapshots/');
  expect(ALWAYS_EXCLUDE).not.toContain('/settings.json');
});

test('SESSION_EXCLUDE holds the session/working dirs', () => {
  expect(SESSION_EXCLUDE).toEqual(
    ['projects/', 'sessions/', 'plans/', 'tasks/', 'todos/', 'usage-data/', 'cache/', 'backups/'],
  );
});
