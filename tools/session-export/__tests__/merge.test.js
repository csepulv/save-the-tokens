import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/merge.js';

let sourceRoot;
let destRoot;
let stdoutLines;
let stderrChunks;
let exitCalls;

beforeEach(async () => {
  sourceRoot = await mkdtemp(join(tmpdir(), 'merge-src-'));
  destRoot = await mkdtemp(join(tmpdir(), 'merge-dst-'));
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
  await rm(sourceRoot, { recursive: true, force: true });
  await rm(destRoot, { recursive: true, force: true });
});

async function writeSession(claudeDir, encodedProject, sessionId, customTitle, mtime) {
  const dir = join(claudeDir, 'projects', encodedProject);
  await mkdir(dir, { recursive: true });
  const lines = [];
  if (customTitle) {
    lines.push(JSON.stringify({ type: 'custom-title', customTitle }));
  }
  lines.push(JSON.stringify({ type: 'user', sessionId, message: { content: 'hi' } }));
  const filePath = join(dir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join('\n'));
  if (mtime) {
    await utimes(filePath, mtime, mtime);
  }
  return filePath;
}

const stderr = () => stderrChunks.join('\n');

test('--all copies missing files from source to dest', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A');
  await writeSession(sourceRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'session-B');

  await run({ source: sourceRoot, dest: destRoot, all: true });

  expect(exitCalls).toEqual([]);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
  expect(stdoutLines.join('\n')).toMatch(/Copied 2/);
});

test('halts on conflict (dest newer than source) without --force or --skip-newer', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-04-26T00:00:00Z');

  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A', oldDate);
  await writeSession(destRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A-different-content', newDate);

  await expect(run({ source: sourceRoot, dest: destRoot, all: true })).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
  expect(stderr()).toMatch(/dest are newer/);

  // Dest file unchanged
  const destContent = await readFile(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'), 'utf-8');
  expect(destContent).toContain('session-A-different-content');
});

test('--force overrides conflict and copies anyway', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-04-26T00:00:00Z');

  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'source-version', oldDate);
  await writeSession(destRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'dest-version', newDate);

  await run({ source: sourceRoot, dest: destRoot, all: true, force: true });

  expect(exitCalls).toEqual([]);
  const destContent = await readFile(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'), 'utf-8');
  expect(destContent).toContain('source-version');
});

test('--skip-newer skips conflicts but copies non-conflicting missing/older', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-04-26T00:00:00Z');

  // file1: missing in dest → should copy
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A', oldDate);
  // file2: conflict (dest newer) → should skip
  await writeSession(sourceRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'source-B', oldDate);
  await writeSession(destRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'dest-B', newDate);

  await run({ source: sourceRoot, dest: destRoot, all: true, 'skip-newer': true });

  expect(exitCalls).toEqual([]);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
  const destB = await readFile(join(destRoot, 'projects', '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd.jsonl'), 'utf-8');
  expect(destB).toContain('dest-B');
  expect(stdoutLines.join('\n')).toMatch(/Copied 1, skipped 1/);
});

test('--all replaces older-in-dest with source (newer in source = no conflict)', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-04-26T00:00:00Z');

  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'source-newer', newDate);
  await writeSession(destRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'dest-older', oldDate);

  await run({ source: sourceRoot, dest: destRoot, all: true });

  expect(exitCalls).toEqual([]);
  const destContent = await readFile(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'), 'utf-8');
  expect(destContent).toContain('source-newer');
});

test('equal-mtime files are skipped (not copied, not counted as conflict)', async () => {
  const date = new Date('2026-04-01T00:00:00Z');

  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'same', date);
  await writeSession(destRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'same', date);

  await run({ source: sourceRoot, dest: destRoot, all: true });

  expect(exitCalls).toEqual([]);
  expect(stdoutLines.join('\n')).toMatch(/Copied 0.*equal 1/);
});

test('positional id (full UUID) copies only that session', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A');
  await writeSession(sourceRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'session-B');

  await run({
    source: sourceRoot,
    dest: destRoot,
    id: 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd',
  });

  expect(existsSync(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(false);
});

test('positional id as slug (exact custom title) copies only that session', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'nesso-memory');
  await writeSession(sourceRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'other-session');

  await run({ source: sourceRoot, dest: destRoot, id: 'nesso-memory' });

  expect(existsSync(join(destRoot, 'projects', '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(false);
});

test('positional id halts when slug is ambiguous in source', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared');
  await writeSession(sourceRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared');

  await expect(run({ source: sourceRoot, dest: destRoot, id: 'shared' })).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
  expect(stderr()).toMatch(/matches 2 sessions/);
});

test('positional id: substring of an id does NOT match (exact id only)', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A');

  // Substring 'aaaa1111' does not match the full filename
  await expect(run({ source: sourceRoot, dest: destRoot, id: 'aaaa1111' })).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/no session in source matches/);
});

test('--project with exact display-name match copies only that project', async () => {
  // listJsonlFiles + resolveProjectName works against the actual filesystem,
  // so the encoded dir must decode to a real path. Use an encoded dir that
  // resolves predictably (or that exists relative to /).
  // Simpler: rely on the naive split fallback for missing paths, which gives
  // a hyphen-joined name. Encoded "-tmp-projA" → "tmp/projA" via naive split,
  // since /tmp exists but /tmp/projA may not. Use that as the project name.
  const sId1 = 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd';
  const sId2 = 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd';
  await writeSession(sourceRoot, '-tmp-projA', sId1, 'session-A');
  await writeSession(sourceRoot, '-tmp-projB', sId2, 'session-B');

  // Use --all to figure out what resolveProjectName returns for these
  // encoded dirs in this test environment, then re-run with --project.
  // Simpler: run --all to check the system, then a separate --project run.
  // For determinism, pass the result we expect.
  // resolveProjectName in test env will produce something like 'tmp/projA' or 'projA'.
  // We can derive by inspecting one path's stat-resolved name. To keep this test
  // robust across environments, create just one project and verify --project
  // doesn't pick up the other one when name matches exactly.

  // Discover what resolveProjectName returned for projA via --all summary path
  // is overkill — directly compute it.
  const { resolveProjectName } = await import('../lib/project-name.js');
  const projAName = await resolveProjectName('-tmp-projA');

  await run({ source: sourceRoot, dest: destRoot, project: projAName });

  expect(existsSync(join(destRoot, 'projects', '-tmp-projA', `${sId1}.jsonl`))).toBe(true);
  expect(existsSync(join(destRoot, 'projects', '-tmp-projB', `${sId2}.jsonl`))).toBe(false);
});

test('--project with no match exits non-zero', async () => {
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A');

  await expect(run({ source: sourceRoot, dest: destRoot, project: 'nope-not-a-real-project' })).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/no sessions in project/);
  expect(stderr()).toMatch(/session-export list/);
});

test('exactly one of <id>, --project, --all is required', async () => {
  await expect(run({ source: sourceRoot, dest: destRoot })).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});

test('two scope flags is rejected', async () => {
  await expect(run({ source: sourceRoot, dest: destRoot, all: true, id: 'foo' })).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});

test('creates dest project folder when missing', async () => {
  await writeSession(sourceRoot, '-tmp-newProj', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A');

  // dest projects/ doesn't exist yet — should be created
  await run({ source: sourceRoot, dest: destRoot, all: true });

  expect(existsSync(join(destRoot, 'projects', '-tmp-newProj', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true);
});

test('preserves source mtime on dest so re-runs see equal, not conflict', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A', oldDate);

  // First merge: missing in dest → copies
  await run({ source: sourceRoot, dest: destRoot, all: true });
  expect(stdoutLines.join('\n')).toMatch(/Copied 1/);

  // Reset captures
  stdoutLines.length = 0;
  stderrChunks.length = 0;
  exitCalls.length = 0;

  // Second merge: should see `equal`, not conflict
  await run({ source: sourceRoot, dest: destRoot, all: true });
  expect(exitCalls).toEqual([]);
  expect(stdoutLines.join('\n')).toMatch(/Copied 0.*conflicts 0.*equal 1/);
});

test('halt prints conflict list with mtimes', async () => {
  const oldDate = new Date('2026-01-01T00:00:00Z');
  const newDate = new Date('2026-04-26T00:00:00Z');

  await writeSession(sourceRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A', oldDate);
  await writeSession(destRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'session-A', newDate);

  await expect(run({ source: sourceRoot, dest: destRoot, all: true })).rejects.toThrow('__exit_1__');

  expect(stderr()).toContain('aaaa1111');
  expect(stderr()).toMatch(/dest:.*2026-04-26/);
  expect(stderr()).toMatch(/source:.*2026-01-01/);
});
