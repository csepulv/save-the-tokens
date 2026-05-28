import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/move.js';
import { resolveProjectName, clearCache } from '../lib/project-name.js';

let sourceDir;
let destDir;
let stdoutLines;
let stderrChunks;
let exitCalls;

beforeEach(async () => {
  sourceDir = await mkdtemp(join(tmpdir(), 'mv-src-'));
  destDir = await mkdtemp(join(tmpdir(), 'mv-dst-'));
  stdoutLines = [];
  stderrChunks = [];
  exitCalls = [];
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
  await rm(sourceDir, { recursive: true, force: true });
  await rm(destDir, { recursive: true, force: true });
});

async function writeSession(claudeDir, encodedProject, sessionId, customTitle, mtime) {
  const dir = join(claudeDir, 'projects', encodedProject);
  await mkdir(dir, { recursive: true });
  const lines = [];
  if (customTitle) lines.push(JSON.stringify({ type: 'custom-title', customTitle }));
  lines.push(JSON.stringify({ type: 'user', message: { content: 'hi' } }));
  const filePath = join(dir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join('\n'));
  if (mtime) await utimes(filePath, mtime, mtime);
  return filePath;
}

const stderr = () => stderrChunks.join('\n');
const stdout = () => stdoutLines.join('\n');
const deps = () => ({ loadConfig: async () => ({ sources: { default: destDir } }) });

const ID_A = 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd';
const ID_B = 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd';
const sourcePath = (encoded, id) => join(sourceDir, 'projects', encoded, `${id}.jsonl`);
const destPath = (encoded, id) => join(destDir, 'projects', encoded, `${id}.jsonl`);

test('dry-run (no --yes) lists the move and changes nothing', async () => {
  const src = await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'sess-A');

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect(exitCalls).toEqual([]);
  expect(existsSync(src)).toBe(true);
  expect(existsSync(destPath('-tmp-mv-A', ID_A))).toBe(false);
  expect(stderr()).toMatch(/Would move 1 session/);
  expect(stderr()).toMatch(/--yes/);
});

test('--yes copies to dest and deletes from source', async () => {
  const src = await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'sess-A');
  await writeSession(sourceDir, '-tmp-mv-B', ID_B, 'sess-B');

  await run({ id: ID_A, source: sourceDir, dest: destDir, yes: true }, deps());

  expect(existsSync(src)).toBe(false);
  expect(existsSync(destPath('-tmp-mv-A', ID_A))).toBe(true);
  // The unmatched session is untouched in source.
  expect(existsSync(sourcePath('-tmp-mv-B', ID_B))).toBe(true);
  expect(stderr()).toMatch(/Moved 1 session/);
});

test('--yes with --project moves every session in the project', async () => {
  const projA = await resolveProjectName('-tmp-mv-A');
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'a1');
  await writeSession(sourceDir, '-tmp-mv-A', ID_B, 'a2');

  await run({ project: projA, source: sourceDir, dest: destDir, yes: true }, deps());

  expect(existsSync(destPath('-tmp-mv-A', ID_A))).toBe(true);
  expect(existsSync(destPath('-tmp-mv-A', ID_B))).toBe(true);
  expect(existsSync(sourcePath('-tmp-mv-A', ID_A))).toBe(false);
});

test('--yes cleans up the source project dir once emptied', async () => {
  await writeSession(sourceDir, '-tmp-mv-solo', ID_A, 'sess-A');

  await run({ id: ID_A, source: sourceDir, dest: destDir, yes: true }, deps());

  expect(existsSync(join(sourceDir, 'projects', '-tmp-mv-solo'))).toBe(false);
  expect(stderr()).toMatch(/cleaned up 1 empty project dir/);
});

test('--yes preserves source mtime on the moved file', async () => {
  const mtime = new Date('2026-03-15T00:00:00Z');
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'sess-A', mtime);

  await run({ id: ID_A, source: sourceDir, dest: destDir, yes: true }, deps());

  expect((await stat(destPath('-tmp-mv-A', ID_A))).mtime.getTime()).toBe(mtime.getTime());
});

test('dry-run annotates a session that would overwrite an existing dest file', async () => {
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'source-version');
  await writeSession(destDir, '-tmp-mv-A', ID_A, 'dest-version');

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect(stdout()).toMatch(/overwrites existing in dest/);
});

test('--yes overwrites an existing dest file', async () => {
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'source-version');
  await writeSession(destDir, '-tmp-mv-A', ID_A, 'dest-version', new Date('2030-01-01T00:00:00Z'));

  await run({ id: ID_A, source: sourceDir, dest: destDir, yes: true }, deps());

  expect(await readFile(destPath('-tmp-mv-A', ID_A), 'utf-8')).toContain('source-version');
});

test('rejects --source and --dest resolving to the same directory', async () => {
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'sess-A');

  await expect(
    run({ id: ID_A, source: sourceDir, dest: sourceDir, yes: true }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/same directory/);
});

test('halts non-zero when nothing matches', async () => {
  await writeSession(sourceDir, '-tmp-mv-A', ID_A, 'sess-A');

  await expect(
    run({ id: 'no-such-session', source: sourceDir, dest: destDir, yes: true }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/no sessions matched/i);
});

test('halts when the source directory does not exist', async () => {
  await expect(
    run({ id: ID_A, source: join(tmpdir(), 'mv-does-not-exist-xyz'), dest: destDir }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/source directory does not exist/);
});

test('exactly one of <id>, --project required', async () => {
  await expect(
    run({ source: sourceDir, dest: destDir }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});

test('both <id> and --project rejected', async () => {
  await expect(
    run({ id: ID_A, project: 'foo', source: sourceDir, dest: destDir }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/exactly one of/);
});
