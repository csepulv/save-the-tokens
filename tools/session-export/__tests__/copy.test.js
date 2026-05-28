import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/copy.js';
import { resolveProjectName, clearCache } from '../lib/project-name.js';

let sourceDir;
let destDir;
let stdoutLines;
let stderrChunks;
let exitCalls;

beforeEach(async () => {
  sourceDir = await mkdtemp(join(tmpdir(), 'cp-src-'));
  destDir = await mkdtemp(join(tmpdir(), 'cp-dst-'));
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
const destPath = (encoded, id) => join(destDir, 'projects', encoded, `${id}.jsonl`);

test('copies a session by exact UUID, leaving others behind', async () => {
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'sess-A');
  await writeSession(sourceDir, '-tmp-cp-B', ID_B, 'sess-B');

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect(exitCalls).toEqual([]);
  expect(existsSync(destPath('-tmp-cp-A', ID_A))).toBe(true);
  expect(existsSync(destPath('-tmp-cp-B', ID_B))).toBe(false);
  expect(stdout()).toMatch(/Copied 1 session/);
});

test('copies a session by exact title slug', async () => {
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'unique-slug');
  await writeSession(sourceDir, '-tmp-cp-B', ID_B, 'other-slug');

  await run({ id: 'unique-slug', source: sourceDir, dest: destDir }, deps());

  expect(existsSync(destPath('-tmp-cp-A', ID_A))).toBe(true);
  expect(existsSync(destPath('-tmp-cp-B', ID_B))).toBe(false);
});

test('copies every session in a project with --project', async () => {
  const projA = await resolveProjectName('-tmp-cp-A');
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'a1');
  await writeSession(sourceDir, '-tmp-cp-A', ID_B, 'a2');
  await writeSession(sourceDir, '-tmp-cp-B', 'cccc3333-aaaa-bbbb-cccc-dddddddddddd', 'b1');

  await run({ project: projA, source: sourceDir, dest: destDir }, deps());

  expect(existsSync(destPath('-tmp-cp-A', ID_A))).toBe(true);
  expect(existsSync(destPath('-tmp-cp-A', ID_B))).toBe(true);
  expect(existsSync(destPath('-tmp-cp-B', 'cccc3333-aaaa-bbbb-cccc-dddddddddddd'))).toBe(false);
});

test('overwrites an existing dest file unconditionally', async () => {
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'source-version');
  // A pre-existing, newer dest file — copy overwrites it anyway (unlike merge).
  await writeSession(destDir, '-tmp-cp-A', ID_A, 'dest-version', new Date('2030-01-01T00:00:00Z'));

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect(exitCalls).toEqual([]);
  expect(await readFile(destPath('-tmp-cp-A', ID_A), 'utf-8')).toContain('source-version');
});

test('preserves source mtime on the copy', async () => {
  const mtime = new Date('2026-02-14T00:00:00Z');
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'sess-A', mtime);

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect((await stat(destPath('-tmp-cp-A', ID_A))).mtime.getTime()).toBe(mtime.getTime());
});

test('creates the dest project dir when missing', async () => {
  await writeSession(sourceDir, '-tmp-cp-fresh', ID_A, 'sess-A');

  await run({ id: ID_A, source: sourceDir, dest: destDir }, deps());

  expect(existsSync(destPath('-tmp-cp-fresh', ID_A))).toBe(true);
});

test('rejects --source and --dest resolving to the same directory', async () => {
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'sess-A');

  await expect(
    run({ id: ID_A, source: sourceDir, dest: sourceDir }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/same directory/);
});

test('halts non-zero when nothing matches', async () => {
  await writeSession(sourceDir, '-tmp-cp-A', ID_A, 'sess-A');

  await expect(
    run({ id: 'no-such-session', source: sourceDir, dest: destDir }, deps())
  ).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/no sessions matched/i);
});

test('halts when the source directory does not exist', async () => {
  await expect(
    run({ id: ID_A, source: join(tmpdir(), 'cp-does-not-exist-xyz'), dest: destDir }, deps())
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
