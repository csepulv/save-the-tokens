import { test, expect } from 'vitest';
import { findJsonl, listConversations } from '../lib/discover.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

// For discover tests, we need a directory structure like .claude/projects/<project>/<session>.jsonl
// We'll use deps injection to mock the filesystem

function makeMockFs(files) {
  // files: { path: content }
  const allPaths = Object.keys(files);

  const readdir = async (dir, opts) => {
    const entries = new Map();
    for (const p of allPaths) {
      if (!p.startsWith(dir + '/')) continue;
      const relative = p.slice(dir.length + 1);
      const firstPart = relative.split('/')[0];
      const isDir = relative.includes('/');
      entries.set(firstPart, isDir ? 'dir' : 'file');
    }
    return [...entries.entries()].map(([name, type]) => ({
      name,
      isDirectory: () => type === 'dir',
      isFile: () => type === 'file',
    }));
  };

  const readFile = async (path) => {
    if (files[path]) return files[path];
    throw new Error(`ENOENT: ${path}`);
  };

  const stat = async (path) => {
    if (files[path]) return { mtime: new Date('2026-04-04T00:00:00Z') };
    throw new Error(`ENOENT: ${path}`);
  };

  return { readdir, readFile, stat };
}

test('finds JSONL by partial session ID', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/abc12345-def6-7890-abcd-ef1234567890.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    '/mock/.claude/projects/-home-test-myapp/fff99999-aaaa-bbbb-cccc-dddddddddddd.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'world' } }),
  };

  const deps = makeMockFs(files);
  const result = await findJsonl('abc123', '/mock/.claude', deps);
  expect(result).toContain('abc12345');
});

test('finds JSONL by custom title', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/abc12345-session.jsonl': [
      JSON.stringify({ type: 'custom-title', customTitle: 'my-special-session' }),
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    ].join('\n'),
  };

  const deps = makeMockFs(files);
  const result = await findJsonl('my-special', '/mock/.claude', deps);
  expect(result).toContain('abc12345-session.jsonl');
});

test('returns null when no match found', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/abc12345.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
  };

  const deps = makeMockFs(files);
  const result = await findJsonl('zzz-no-match', '/mock/.claude', deps);
  expect(result).toBeNull();
});

test('lists conversations sorted by date', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'first conversation' } }),
    '/mock/.claude/projects/-home-test-other/session-bbbb-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'second conversation' } }),
  };

  const callOrder = [];
  const deps = makeMockFs(files);
  const origStat = deps.stat;
  deps.stat = async (path) => {
    // Give different dates to test sorting
    if (path.includes('aaaa')) return { mtime: new Date('2026-04-01T00:00:00Z') };
    if (path.includes('bbbb')) return { mtime: new Date('2026-04-03T00:00:00Z') };
    return origStat(path);
  };

  const result = await listConversations('/mock/.claude', deps);
  expect(result.length).toBe(2);
  // Newest first
  expect(result[0].sessionId).toContain('bbbb');
  expect(result[1].sessionId).toContain('aaaa');
});

test('lists conversations with custom title as preview', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl': [
      JSON.stringify({ type: 'custom-title', customTitle: 'My Project Setup' }),
      JSON.stringify({ type: 'user', message: { content: 'set up the project' } }),
    ].join('\n'),
  };

  const deps = makeMockFs(files);
  const result = await listConversations('/mock/.claude', deps);
  expect(result[0].preview).toBe('My Project Setup');
});

test('lists conversations with first user message as preview when no title', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'tell me a joke about programming' } }),
  };

  const deps = makeMockFs(files);
  const result = await listConversations('/mock/.claude', deps);
  expect(result[0].preview).toBe('tell me a joke about programming');
});

test('derives project name from directory path', async () => {
  const files = {
    '/mock/.claude/projects/-home-theuser-workspace-foobar/session-aaaa-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
  };

  const deps = makeMockFs(files);
  // resolveProjectName uses homedir() to strip the prefix; without a mock it'd
  // fall back to the real system homedir (e.g. /Users/whoever) and fail to strip.
  deps.homedir = () => '/home/theuser';
  const result = await listConversations('/mock/.claude', deps);
  expect(result[0].project).toBe('workspace/foobar');
});

test('strips XML tags from first user message preview', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl': [
      JSON.stringify({ type: 'user', message: { content: '<command-message>dsf-workshop</command-message> <command-name>/dsf-workshop</command-name>' } }),
      JSON.stringify({ type: 'user', message: { content: 'the real first message' } }),
    ].join('\n'),
  };

  const deps = makeMockFs(files);
  const result = await listConversations('/mock/.claude', deps);
  // Should skip the XML-only first message and use the second
  expect(result[0].preview).not.toContain('<');
});

test('skips local-command infrastructure messages in preview', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl': [
      JSON.stringify({ type: 'user', message: { content: '<local-command-caveat>Caveat: blah</local-command-caveat>' } }),
      JSON.stringify({ type: 'user', message: { content: 'the actual question' } }),
    ].join('\n'),
  };

  const deps = makeMockFs(files);
  const result = await listConversations('/mock/.claude', deps);
  expect(result[0].preview).toBe('the actual question');
});

test('resolves hyphenated project names correctly in listing', async () => {
  const files = {
    '/mock/.claude/projects/-home-theuser-workspace-michi/session-aaaa-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
  };

  // Mock stat to resolve the hyphenated path correctly
  const deps = makeMockFs(files);
  const origStat = deps.stat;
  deps.stat = async (path) => {
    // Filesystem resolution paths
    const existingPaths = [
      '/home', '/home/theuser', '/home/theuser/workspace', '/home/theuser/workspace/michi',
    ];
    if (existingPaths.includes(path)) return { mtime: new Date(), isDirectory: () => true };
    return origStat(path);
  };
  // resolveProjectName uses homedir() for stripping prefix
  deps.homedir = () => '/home/theuser';

  const result = await listConversations('/mock/.claude', deps);
  expect(result[0].project).toBe('workspace/michi');
});

test('skips subagents directories', async () => {
  const files = {
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    '/mock/.claude/projects/-home-test-myapp/session-aaaa-1111-2222-333344445555/subagents/agent-123.jsonl':
      JSON.stringify({ type: 'user', message: { content: 'subagent' } }),
  };

  const deps = makeMockFs(files);
  const result = await listConversations('/mock/.claude', deps);
  expect(result.length).toBe(1);
  expect(result[0].sessionId).toContain('aaaa');
});
