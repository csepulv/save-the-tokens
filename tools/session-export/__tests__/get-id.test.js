import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/get-id.js';

let tmpRoot;
let stdoutLines;
let stderrChunks;
let exitCalls;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'get-id-test-'));
  stdoutLines = [];
  stderrChunks = [];
  exitCalls = [];

  vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdoutLines.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderrChunks.push(args.map(String).join(' '));
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCalls.push(code);
    throw new Error(`__exit_${code}__`);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeSession(claudeDir, encodedProject, sessionId, customTitle) {
  const dir = join(claudeDir, 'projects', encodedProject);
  await mkdir(dir, { recursive: true });
  const lines = [];
  if (customTitle) {
    lines.push(JSON.stringify({ type: 'custom-title', customTitle }));
  }
  lines.push(JSON.stringify({ type: 'user', message: { content: 'hi' } }));
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n'));
}

test('returns single match as <id>\\t<source>\\t<project>', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory');

  await run({ slug: 'nesso-memory', source: tmpRoot });

  expect(exitCalls).toEqual([]);
  expect(stdoutLines).toHaveLength(1);
  const [id, source, project] = stdoutLines[0].split('\t');
  expect(id).toBe('aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  expect(source).toBe(tmpRoot);
  expect(project).toBeTruthy();
});

test('lists every match when slug is ambiguous', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory');

  await run({ slug: 'nesso-memory', source: tmpRoot });

  expect(exitCalls).toEqual([]);
  expect(stdoutLines).toHaveLength(2);
  expect(stdoutLines.some((l) => l.startsWith('aaaa1111'))).toBe(true);
  expect(stdoutLines.some((l) => l.startsWith('bbbb2222'))).toBe(true);
});

test('exits non-zero when no match', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'something-else');

  await expect(run({ slug: 'nesso-memory', source: tmpRoot })).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
  expect(stderrChunks.join('')).toMatch(/No matches/);
});

test('exact-match: does not match prefix-similar titles', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory-extended');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory');

  await run({ slug: 'nesso-memory', source: tmpRoot });

  expect(stdoutLines).toHaveLength(1);
  expect(stdoutLines[0]).toContain('bbbb2222');
});

test('does not match a session by first-message preview (title only)', async () => {
  // Session has no custom title — only a first user message that happens
  // to equal the slug. get-id must not match it.
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', null);

  await expect(run({ slug: 'hi', source: tmpRoot })).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
});
