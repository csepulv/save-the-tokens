// Ported from tools/hermes/lib/__tests__/claude-seed.test.js (M3a), sync.
import { test, expect } from 'vitest';
import { seedClaudeConfig } from '../claude-seed.js';

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

test('skips when the claude config dir already has content', () => {
  let rsynced = false;
  const r = seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: (p) => (p === '/target' ? ['settings.json'] : []),
    runRsync: () => { rsynced = true; },
  });
  expect(r.seeded).toBe(false);
  expect(rsynced).toBe(false);
});

test('skips when the source ~/.claude does not exist', () => {
  let rsynced = false;
  const r = seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: (p) => { if (p === '/target') return []; throw enoent(); },
    runRsync: () => { rsynced = true; },
  });
  expect(r.seeded).toBe(false);
  expect(r.reason).toMatch(/\.claude/);
  expect(rsynced).toBe(false);
});

test('seeds: rsync, credentials copy, mcpServers strip, ensure-dirs', () => {
  const calls = { rsync: [], copyFile: [], mkdir: [], writeFile: [] };
  const r = seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: (src, dest, excludes) => calls.rsync.push({ src, dest, excludes }),
    copyFile: (src, dest) => calls.copyFile.push({ src, dest }),
    readFile: (p) => {
      if (p === '/target/settings.json') return JSON.stringify({ model: 'x', mcpServers: { a: { command: 'y' } } });
      throw enoent();
    },
    writeFile: (p, content) => calls.writeFile.push({ p, content }),
    mkdir: (p, opts) => calls.mkdir.push({ p, opts }),
  });
  expect(r.seeded).toBe(true);
  expect(calls.rsync).toHaveLength(1);
  expect(calls.rsync[0]).toMatchObject({ src: '/src/.claude', dest: '/target' });
  expect(calls.rsync[0].excludes).toContain('.credentials.json');
  expect(calls.copyFile[0]).toEqual({ src: '/src/.claude/.credentials.json', dest: '/target/.credentials.json' });
  const written = calls.writeFile.find((w) => w.p === '/target/settings.json');
  expect(JSON.parse(written.content).mcpServers).toBeUndefined();
  expect(JSON.parse(written.content).model).toBe('x');
  expect(calls.mkdir.map((m) => m.p)).toContain('/target/projects');
});

test('a missing credentials file does not fail the seed', () => {
  const r = seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: () => {},
    copyFile: () => { throw enoent(); },
    readFile: () => { throw enoent(); },
    writeFile: () => {},
    mkdir: () => {},
  });
  expect(r.seeded).toBe(true);
});

test('a settings.json without mcpServers is left untouched', () => {
  const calls = { writeFile: [] };
  seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: () => {},
    copyFile: () => {},
    readFile: (p) => {
      if (p === '/target/settings.json') return JSON.stringify({ model: 'x' });
      throw enoent();
    },
    writeFile: (p, content) => calls.writeFile.push({ p, content }),
    mkdir: () => {},
  });
  expect(calls.writeFile.find((w) => w.p === '/target/settings.json')).toBeUndefined();
});
