import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, utimes, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveIdScope,
  resolveProjectScope,
  copySessionFile,
  buildCopyEntries,
  collectScopeFiles,
  cleanupEmptyDirs,
} from '../lib/session-files.js';
import { resolveProjectName, clearCache } from '../lib/project-name.js';
import { extractEncodedProjectDir } from '../lib/discover.js';

let srcDir;
let destDir;
let stderrChunks;
let exitCalls;

beforeEach(async () => {
  srcDir = await mkdtemp(join(tmpdir(), 'sf-src-'));
  destDir = await mkdtemp(join(tmpdir(), 'sf-dst-'));
  stderrChunks = [];
  exitCalls = [];
  clearCache();

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
  await rm(srcDir, { recursive: true, force: true });
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

const ID_A = 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd';
const ID_B = 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd';

// --- resolveIdScope ---------------------------------------------------

test('resolveIdScope resolves an exact UUID to its path', async () => {
  const pathA = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'sess-B');

  expect(await resolveIdScope(ID_A, srcDir)).toEqual([pathA]);
});

test('resolveIdScope resolves an exact title slug to its path', async () => {
  const pathA = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'unique-slug');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'other-slug');

  expect(await resolveIdScope('unique-slug', srcDir)).toEqual([pathA]);
});

test('resolveIdScope returns [] when nothing matches', async () => {
  await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');

  expect(await resolveIdScope('not-a-real-session', srcDir)).toEqual([]);
  expect(exitCalls).toEqual([]);
});

test('resolveIdScope does not substring-match a UUID', async () => {
  await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');

  expect(await resolveIdScope('aaaa1111', srcDir)).toEqual([]);
});

test('resolveIdScope exits when a slug is ambiguous', async () => {
  await writeSession(srcDir, '-tmp-sf-A', ID_A, 'shared');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'shared');

  await expect(resolveIdScope('shared', srcDir)).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/matches 2 sessions/);
});

test('resolveIdScope exits when an id appears under multiple project dirs', async () => {
  await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');
  await writeSession(srcDir, '-tmp-sf-B', ID_A, 'sess-A-dup');

  await expect(resolveIdScope(ID_A, srcDir)).rejects.toThrow('__exit_1__');
  expect(stderr()).toMatch(/appears in 2 projects/);
});

// --- resolveProjectScope ----------------------------------------------

test('resolveProjectScope exact match returns that project\'s sessions', async () => {
  const projA = await resolveProjectName('-tmp-sf-A');
  const pathA = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'sess-B');

  expect(await resolveProjectScope(projA, srcDir)).toEqual([pathA]);
});

test('resolveProjectScope glob pattern matches multiple projects', async () => {
  const fooName = await resolveProjectName('-tmp-sf-wild-foo');
  const path1 = await writeSession(srcDir, '-tmp-sf-wild-foo', ID_A, 'a');
  const path2 = await writeSession(srcDir, '-tmp-sf-wild-bar', ID_B, 'b');
  await writeSession(srcDir, '-tmp-sf-keep-baz', 'cccc3333-aaaa-bbbb-cccc-dddddddddddd', 'c');

  const pattern = fooName.slice(0, fooName.lastIndexOf('/') + 1) + '*';
  const matched = await resolveProjectScope(pattern, srcDir);

  expect(matched.sort()).toEqual([path1, path2].sort());
});

test('resolveProjectScope returns [] when nothing matches', async () => {
  await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A');

  expect(await resolveProjectScope('nope-not-a-project', srcDir)).toEqual([]);
});

test('resolveProjectScope treats regex specials as literal', async () => {
  const fooName = await resolveProjectName('-tmp-sf-regex-foo');
  await writeSession(srcDir, '-tmp-sf-regex-foo', ID_A, 'a');

  const literalPrefix = fooName.slice(0, fooName.lastIndexOf('/') + 1);
  expect(await resolveProjectScope(`${literalPrefix}foo.bar`, srcDir)).toEqual([]);
});

// --- copySessionFile --------------------------------------------------

test('copySessionFile copies content, creates dest dirs, preserves mtime', async () => {
  const mtime = new Date('2026-02-01T00:00:00Z');
  const sourcePath = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'sess-A', mtime);
  const destPath = join(destDir, 'projects', '-tmp-sf-A', `${ID_A}.jsonl`);

  await copySessionFile({ sourcePath, destPath, sourceMtime: mtime });

  expect(existsSync(destPath)).toBe(true);
  expect(await readFile(destPath, 'utf-8')).toBe(await readFile(sourcePath, 'utf-8'));
  expect((await stat(destPath)).mtime.getTime()).toBe(mtime.getTime());
});

// --- buildCopyEntries -------------------------------------------------

test('buildCopyEntries maps source paths to dest paths under projects/', async () => {
  const mtime = new Date('2026-03-03T00:00:00Z');
  const p1 = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'a', mtime);

  const entries = await buildCopyEntries([p1], srcDir, destDir);

  expect(entries).toHaveLength(1);
  expect(entries[0].sourcePath).toBe(p1);
  expect(entries[0].destPath).toBe(join(destDir, 'projects', '-tmp-sf-A', `${ID_A}.jsonl`));
  expect(entries[0].sourceMtime.getTime()).toBe(mtime.getTime());
});

// --- collectScopeFiles ------------------------------------------------

test('collectScopeFiles dispatches on args.id', async () => {
  const p1 = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'a');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'b');

  expect(await collectScopeFiles({ id: ID_A }, srcDir)).toEqual([p1]);
});

test('collectScopeFiles dispatches on args.project', async () => {
  const projA = await resolveProjectName('-tmp-sf-A');
  const p1 = await writeSession(srcDir, '-tmp-sf-A', ID_A, 'a');
  await writeSession(srcDir, '-tmp-sf-B', ID_B, 'b');

  expect(await collectScopeFiles({ project: projA }, srcDir)).toEqual([p1]);
});

// --- cleanupEmptyDirs -------------------------------------------------

test('cleanupEmptyDirs removes an emptied project dir', async () => {
  const p1 = await writeSession(srcDir, '-tmp-sf-empty', ID_A, 'a');
  await rm(p1);
  const encoded = extractEncodedProjectDir(p1);

  const cleaned = await cleanupEmptyDirs([{ sourceDir: srcDir, encoded }]);

  expect(cleaned).toBe(1);
  expect(existsSync(join(srcDir, 'projects', '-tmp-sf-empty'))).toBe(false);
});

test('cleanupEmptyDirs preserves a dir with a non-empty subagents/', async () => {
  const p1 = await writeSession(srcDir, '-tmp-sf-sub', ID_A, 'a');
  const subDir = join(srcDir, 'projects', '-tmp-sf-sub', 'subagents');
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, 'trace.jsonl'), '{}');
  await rm(p1);
  const encoded = extractEncodedProjectDir(p1);

  const cleaned = await cleanupEmptyDirs([{ sourceDir: srcDir, encoded }]);

  expect(cleaned).toBe(0);
  expect(existsSync(join(srcDir, 'projects', '-tmp-sf-sub'))).toBe(true);
});
