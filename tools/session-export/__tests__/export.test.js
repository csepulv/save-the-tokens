import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/commands/export.js';

let tmpRoot;
let stdoutChunks;
let stderrChunks;
let exitCalls;
let stdoutSpy;
let stderrSpy;
let exitSpy;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'session-export-test-'));
  stdoutChunks = [];
  stderrChunks = [];
  exitCalls = [];

  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  // console.error writes through to stderr, but in tests stdio is wrapped —
  // spy on console.error directly to capture the strings.
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderrChunks.push(args.map((a) => String(a)).join(' ') + '\n');
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCalls.push(code);
    throw new Error(`__exit_${code}__`);
  });
});

afterEach(async () => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
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
  lines.push(JSON.stringify({
    type: 'user',
    sessionId,
    cwd: '/tmp/test',
    message: { role: 'user', content: 'first message in ' + sessionId },
    timestamp: '2026-04-26T12:00:00.000Z',
  }));
  lines.push(JSON.stringify({
    type: 'assistant',
    sessionId,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'response in ' + sessionId }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-test',
    },
    timestamp: '2026-04-26T12:00:01.000Z',
  }));
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n'));
}

const stderr = () => stderrChunks.join('');
const stdout = () => stdoutChunks.join('');

test('ambiguous slug halts without --all and lists matches', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');

  await expect(run(
    { id: 'shared-title', source: tmpRoot, format: 'md' },
    { outputFlag: undefined },
  )).rejects.toThrow('__exit_1__');

  expect(exitCalls).toEqual([1]);
  expect(stderr()).toMatch(/matches 2 sessions/);
  expect(stderr()).toContain('aaaa1111');
  expect(stderr()).toContain('bbbb2222');
  expect(stdout()).toBe('');
});

test('--all with multiple matches emits each to stdout', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');

  await run(
    { id: 'shared-title', all: true, source: tmpRoot, format: 'md' },
    { outputFlag: undefined },
  );

  expect(exitCalls).toEqual([]);
  expect(stdout()).toContain('aaaa1111');
  expect(stdout()).toContain('bbbb2222');
});

test('--all with --output as literal file is refused', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');

  await expect(run(
    { id: 'shared-title', all: true, source: tmpRoot, format: 'md' },
    { outputFlag: join(tmpRoot, 'out.md') },
  )).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/--all with --output <file> is ambiguous/);
});

test('--all with --output dir/ writes one file per session with id-suffix', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');
  await writeSession(tmpRoot, '-tmp-projB', 'bbbb2222-aaaa-bbbb-cccc-dddddddddddd', 'shared-title');

  const outDir = join(tmpRoot, 'out') + '/';
  await run(
    { id: 'shared-title', all: true, source: tmpRoot, format: 'md' },
    { outputFlag: outDir },
  );

  const files = await readdir(join(tmpRoot, 'out'));
  expect(files).toHaveLength(2);
  // Both share the title-derived slug; suffix disambiguates.
  expect(files.every((f) => f.startsWith('shared-title-') && f.endsWith('.md'))).toBe(true);
  expect(files.some((f) => f.includes('aaaa1111'))).toBe(true);
  expect(files.some((f) => f.includes('bbbb2222'))).toBe(true);
});

test('unambiguous slug exports unchanged (regression check)', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'unique-title');

  await run(
    { id: 'unique-title', source: tmpRoot, format: 'md' },
    { outputFlag: undefined },
  );

  expect(exitCalls).toEqual([]);
  expect(stdout()).toContain('aaaa1111');
  expect(stdout()).toContain('first message in aaaa1111');
});

test('no match exits non-zero', async () => {
  await writeSession(tmpRoot, '-tmp-projA', 'aaaa1111-aaaa-bbbb-cccc-dddddddddddd', 'some-title');

  await expect(run(
    { id: 'no-such-thing', source: tmpRoot, format: 'md' },
    { outputFlag: undefined },
  )).rejects.toThrow('__exit_1__');

  expect(stderr()).toMatch(/Could not find conversation/);
});
