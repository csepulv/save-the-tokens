import { test, expect } from 'vitest';
import { seedClaudeConfig } from '../claude-seed.js';

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

test('skips when the claude config dir already has content', async () => {
  let rsynced = false;
  const r = await seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: async (p) => (p === '/target' ? ['settings.json'] : []),
    runRsync: async () => { rsynced = true; },
  });
  expect(r.seeded).toBe(false);
  expect(rsynced).toBe(false);
});

test('skips when the source ~/.claude does not exist', async () => {
  let rsynced = false;
  const r = await seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: async (p) => {
      if (p === '/target') return [];
      throw enoent();
    },
    runRsync: async () => { rsynced = true; },
  });
  expect(r.seeded).toBe(false);
  expect(r.reason).toMatch(/\.claude/);
  expect(rsynced).toBe(false);
});

test('seeds: rsync, credentials copy, mcpServers strip, ensure-dirs', async () => {
  const calls = { rsync: [], copyFile: [], mkdir: [], writeFile: [] };
  const r = await seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: async (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: async (src, dest, excludes) => calls.rsync.push({ src, dest, excludes }),
    copyFile: async (src, dest) => calls.copyFile.push({ src, dest }),
    readFile: async (p) => {
      if (p === '/target/settings.json') {
        return JSON.stringify({ model: 'x', mcpServers: { a: { command: 'y' } } });
      }
      throw enoent();
    },
    writeFile: async (p, content) => calls.writeFile.push({ p, content }),
    mkdir: async (p, opts) => calls.mkdir.push({ p, opts }),
  });
  expect(r.seeded).toBe(true);
  expect(calls.rsync).toHaveLength(1);
  expect(calls.rsync[0]).toMatchObject({ src: '/src/.claude', dest: '/target' });
  expect(calls.rsync[0].excludes).toContain('.credentials.json');
  expect(calls.copyFile[0]).toEqual({
    src: '/src/.claude/.credentials.json',
    dest: '/target/.credentials.json',
  });
  const written = calls.writeFile.find((w) => w.p === '/target/settings.json');
  expect(JSON.parse(written.content).mcpServers).toBeUndefined();
  expect(JSON.parse(written.content).model).toBe('x');
  expect(calls.mkdir.map((m) => m.p)).toContain('/target/projects');
});

test('a missing credentials file does not fail the seed', async () => {
  const r = await seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: async (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: async () => {},
    copyFile: async () => { throw enoent(); },
    readFile: async () => { throw enoent(); },
    writeFile: async () => {},
    mkdir: async () => {},
  });
  expect(r.seeded).toBe(true);
});

test('a settings.json without mcpServers is left untouched', async () => {
  const calls = { writeFile: [] };
  await seedClaudeConfig('/target', {
    sourceClaudeDir: '/src/.claude',
    readdir: async (p) => (p === '/target' ? [] : ['settings.json']),
    runRsync: async () => {},
    copyFile: async () => {},
    readFile: async (p) => {
      if (p === '/target/settings.json') return JSON.stringify({ model: 'x' });
      throw enoent();
    },
    writeFile: async (p, content) => calls.writeFile.push({ p, content }),
    mkdir: async () => {},
  });
  expect(calls.writeFile.find((w) => w.p === '/target/settings.json')).toBeUndefined();
});
