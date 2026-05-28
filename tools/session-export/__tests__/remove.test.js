import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/remove.js';
import { resolveProjectName, clearCache } from '../lib/project-name.js';

let sourceA;
let sourceB;
let stdoutLines;
let stderrChunks;
let exitCalls;
let configStub;

beforeEach(async () => {
  sourceA = await mkdtemp(join(tmpdir(), 'rm-srcA-'));
  sourceB = await mkdtemp(join(tmpdir(), 'rm-srcB-'));
  stdoutLines = [];
  stderrChunks = [];
  exitCalls = [];
  configStub = { sources: { default: sourceA, work: sourceB } };
  clearCache();

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
  await rm(sourceA, { recursive: true, force: true });
  await rm(sourceB, { recursive: true, force: true });
});

async function writeSession(claudeDir, encodedProject, sessionId, customTitle) {
  const dir = join(claudeDir, 'projects', encodedProject);
  await mkdir(dir, { recursive: true });
  const lines = [];
  if (customTitle) {
    lines.push(JSON.stringify({ type: 'custom-title', customTitle }));
  }
  lines.push(JSON.stringify({ type: 'user', message: { content: 'hi' } }));
  const filePath = join(dir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join('\n'));
  return filePath;
}

const stderr = () => stderrChunks.join('\n');
const stdout = () => stdoutLines.join('\n');
const deps = () => ({ loadConfig: async () => configStub });

test('exact UUID id deletes only that session (with --yes)', async () => {
  const path1 = await writeSession(sourceA, '-tmp-rm-uuid-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const path2 = await writeSession(sourceA, '-tmp-rm-uuid-B', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd');

  await run({ id: 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', yes: true, source: sourceA }, deps());

  expect(exitCalls).toEqual([]);
  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(true);
});

test('exact slug deletes only that session (with --yes)', async () => {
  const path1 = await writeSession(sourceA, '-tmp-rm-slug-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'unique-slug');
  const path2 = await writeSession(sourceA, '-tmp-rm-slug-B', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'other-slug');

  await run({ id: 'unique-slug', yes: true, source: sourceA }, deps());

  expect(exitCalls).toEqual([]);
  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(true);
});

test('ambiguous slug halts non-zero, deletes nothing', async () => {
  const path1 = await writeSession(sourceA, '-tmp-rm-amb-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared');
  const path2 = await writeSession(sourceA, '-tmp-rm-amb-B', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared');

  await expect(
    run({ id: 'shared', yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
  expect(existsSync(path1)).toBe(true);
  expect(existsSync(path2)).toBe(true);
  expect(stderr()).toMatch(/2 sessions/);
});

test('substring of UUID does NOT match (exact only)', async () => {
  const path1 = await writeSession(sourceA, '-tmp-rm-sub-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');

  await expect(
    run({ id: 'aaaa1111', yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');

  expect(existsSync(path1)).toBe(true);
  expect(stderr()).toMatch(/no sessions matched/i);
});

test('id matching across two sources halts (default walk-all)', async () => {
  const sameId = 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd';
  const path1 = await writeSession(sourceA, '-tmp-rm-multi-A', sameId);
  const path2 = await writeSession(sourceB, '-tmp-rm-multi-B', sameId);

  await expect(
    run({ id: sameId, yes: true }, deps())
  ).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/matches 2 sessions/);
  expect(stderr()).toMatch(/--source/);
  expect(existsSync(path1)).toBe(true);
  expect(existsSync(path2)).toBe(true);
});

test('--project exact deletes all sessions in project, cleans up empty dir', async () => {
  const projAName = await resolveProjectName('-tmp-rm-exact-A');
  const projBName = await resolveProjectName('-tmp-rm-exact-B');
  expect(projAName).not.toBe(projBName);

  const path1 = await writeSession(sourceA, '-tmp-rm-exact-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const path2 = await writeSession(sourceA, '-tmp-rm-exact-A', 'cccc3333-aaaa-bbbb-cccc-dddddddddddd');
  const path3 = await writeSession(sourceA, '-tmp-rm-exact-B', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd');

  await run({ project: projAName, yes: true, source: sourceA }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(false);
  expect(existsSync(path3)).toBe(true);
  expect(existsSync(join(sourceA, 'projects', '-tmp-rm-exact-A'))).toBe(false);
  expect(existsSync(join(sourceA, 'projects', '-tmp-rm-exact-B'))).toBe(true);
});

test('--project wildcard matches multiple projects', async () => {
  // Both encoded names resolve under the same prefix via greedy fs match.
  const fooName = await resolveProjectName('-tmp-rm-wild-foo');
  const barName = await resolveProjectName('-tmp-rm-wild-bar');
  const otherName = await resolveProjectName('-tmp-rm-keep-baz');

  // fooName and barName should differ only in the last segment.
  expect(fooName).not.toBe(barName);
  expect(fooName).not.toBe(otherName);

  const path1 = await writeSession(sourceA, '-tmp-rm-wild-foo', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const path2 = await writeSession(sourceA, '-tmp-rm-wild-bar', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd');
  const path3 = await writeSession(sourceA, '-tmp-rm-keep-baz', 'cccc3333-aaaa-bbbb-cccc-dddddddddddd');

  // Pattern: replace the last segment with '*'
  const lastSlash = fooName.lastIndexOf('/');
  const pattern = fooName.slice(0, lastSlash + 1) + '*';

  await run({ project: pattern, yes: true, source: sourceA }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(false);
  expect(existsSync(path3)).toBe(true);
});

test('--project no matches halts non-zero', async () => {
  await writeSession(sourceA, '-tmp-rm-none-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');

  await expect(
    run({ project: 'nope-not-a-real-project-*', yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/no sessions matched/i);
});

test('default (no --yes) prints plan, deletes nothing', async () => {
  const projName = await resolveProjectName('-tmp-rm-dry-A');
  const path1 = await writeSession(sourceA, '-tmp-rm-dry-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');

  await run({ project: projName, source: sourceA }, deps());

  expect(exitCalls).toEqual([]);
  expect(existsSync(path1)).toBe(true);
  expect(stderr()).toMatch(/Would delete 1 session/);
  expect(stderr()).toMatch(/--yes/);
  // The plan listing should include the session id on stdout
  expect(stdout()).toContain('aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
});

test('walks all sources by default (no --source)', async () => {
  const projName = await resolveProjectName('-tmp-rm-walk-X');
  const path1 = await writeSession(sourceA, '-tmp-rm-walk-X', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const path2 = await writeSession(sourceB, '-tmp-rm-walk-X', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd');

  await run({ project: projName, yes: true }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(false);
});

test('--source restricts to one source', async () => {
  const projName = await resolveProjectName('-tmp-rm-scoped-X');
  const path1 = await writeSession(sourceA, '-tmp-rm-scoped-X', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const path2 = await writeSession(sourceB, '-tmp-rm-scoped-X', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd');

  await run({ project: projName, yes: true, source: sourceA }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(path2)).toBe(true);
});

test('encoded dir with subagents/ content is preserved after delete', async () => {
  const projName = await resolveProjectName('-tmp-rm-sub-content-A');
  const path1 = await writeSession(sourceA, '-tmp-rm-sub-content-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const subDir = join(sourceA, 'projects', '-tmp-rm-sub-content-A', 'subagents');
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, 'agent-trace.jsonl'), '{"a":1}');

  await run({ project: projName, yes: true, source: sourceA }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(subDir)).toBe(true);
  expect(existsSync(join(sourceA, 'projects', '-tmp-rm-sub-content-A'))).toBe(true);
});

test('empty subagents/ dir does not block cleanup', async () => {
  const projName = await resolveProjectName('-tmp-rm-empty-sub-A');
  const path1 = await writeSession(sourceA, '-tmp-rm-empty-sub-A', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');
  const subDir = join(sourceA, 'projects', '-tmp-rm-empty-sub-A', 'subagents');
  await mkdir(subDir, { recursive: true });

  await run({ project: projName, yes: true, source: sourceA }, deps());

  expect(existsSync(path1)).toBe(false);
  expect(existsSync(join(sourceA, 'projects', '-tmp-rm-empty-sub-A'))).toBe(false);
});

test('exactly one of <id>, --project required', async () => {
  await expect(
    run({ yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});

test('both <id> and --project rejected', async () => {
  await expect(
    run({ id: 'foo', project: 'bar', yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});

test('wildcard escapes regex specials (literal dots, parens)', async () => {
  // A pattern with `.` should NOT match arbitrary characters — it's literal.
  const fooName = await resolveProjectName('-tmp-rm-regex-foo');
  const lastSlash = fooName.lastIndexOf('/');
  const literalPrefix = fooName.slice(0, lastSlash + 1);

  await writeSession(sourceA, '-tmp-rm-regex-foo', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd');

  // Pattern uses a literal `.` — unmatched, so no sessions found.
  const pattern = `${literalPrefix}foo.bar`;
  await expect(
    run({ project: pattern, yes: true, source: sourceA }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/no sessions matched/i);
});
