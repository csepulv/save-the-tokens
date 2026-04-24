import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { createCastWriter } from '../cast-writer.js';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cast-writer-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createCastWriter', () => {
  test('writes valid asciicast v2 header', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 120, height: 40 });
    writer.writeHeader();
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    const header = JSON.parse(lines[0]);
    expect(header.version).toBe(2);
    expect(header.width).toBe(120);
    expect(header.height).toBe(40);
    expect(typeof header.timestamp).toBe('number');
    expect(header.env).toHaveProperty('SHELL');
  });

  test('writes output events as [time, "o", data]', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 80, height: 24 });
    writer.writeHeader();
    writer.writeOutput('hello world');
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    const event = JSON.parse(lines[1]);
    expect(event).toHaveLength(3);
    expect(typeof event[0]).toBe('number');
    expect(event[1]).toBe('o');
    expect(event[2]).toBe('hello world');
  });

  test('writes input events as [time, "i", data]', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 80, height: 24 });
    writer.writeHeader();
    writer.writeInput('ls\r');
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    const event = JSON.parse(lines[1]);
    expect(event[1]).toBe('i');
    expect(event[2]).toBe('ls\r');
  });

  test('writes resize events as [time, "r", "COLSxROWS"]', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 80, height: 24 });
    writer.writeHeader();
    writer.writeResize(120, 40);
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    const event = JSON.parse(lines[1]);
    expect(event[1]).toBe('r');
    expect(event[2]).toBe('120x40');
  });

  test('timestamps are monotonically increasing', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 80, height: 24 });
    writer.writeHeader();
    writer.writeOutput('first');
    writer.writeOutput('second');
    writer.writeOutput('third');
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    const times = lines.slice(1).map((l) => JSON.parse(l)[0]);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  test('all lines are valid JSON', async () => {
    const path = join(tempDir, 'test.cast');
    const writer = createCastWriter(path, { width: 80, height: 24 });
    writer.writeHeader();
    writer.writeOutput('data with "quotes" and \nnewlines');
    writer.writeInput('cmd\r');
    writer.writeResize(100, 50);
    await writer.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
