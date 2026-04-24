import { test, expect, describe, vi } from 'vitest';
import { checkSoxAvailable, startRecording, stopRecording } from '../audio-recorder.js';
import { EventEmitter } from 'events';

function makeMockProcess(exitCode = null) {
  const proc = new EventEmitter();
  proc.exitCode = exitCode;
  proc.kill = vi.fn((signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      proc.exitCode = 0;
      proc.emit('exit', 0);
    }
  });
  proc.stdin = { write: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('checkSoxAvailable', () => {
  test('returns true when rec is found', () => {
    const deps = { execFileSync: vi.fn() };
    expect(checkSoxAvailable(deps)).toBe(true);
    expect(deps.execFileSync).toHaveBeenCalledWith('rec', ['--version'], { stdio: 'pipe' });
  });

  test('returns false when rec is not found', () => {
    const deps = { execFileSync: vi.fn(() => { throw new Error('not found'); }) };
    expect(checkSoxAvailable(deps)).toBe(false);
  });
});

describe('startRecording', () => {
  test('spawns rec with correct arguments', () => {
    const mockProc = makeMockProcess();
    const deps = { spawn: vi.fn(() => mockProc) };

    const controller = startRecording('/tmp/test.wav', deps);

    expect(deps.spawn).toHaveBeenCalledWith(
      'rec',
      ['-q', '-r', '16000', '-c', '1', '-b', '16', '/tmp/test.wav'],
      { stdio: 'pipe' }
    );
    expect(controller.outputPath).toBe('/tmp/test.wav');
    expect(typeof controller.audioStartEpoch).toBe('number');
    expect(controller.audioStartEpoch).toBeGreaterThan(0);
  });

  test('captures audioStartEpoch as wall-clock ms', () => {
    const mockProc = makeMockProcess();
    const deps = { spawn: vi.fn(() => mockProc) };

    const before = Date.now();
    const controller = startRecording('/tmp/test.wav', deps);
    const after = Date.now();

    expect(controller.audioStartEpoch).toBeGreaterThanOrEqual(before);
    expect(controller.audioStartEpoch).toBeLessThanOrEqual(after);
  });

  test('checks mic after delay when stat is provided', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    const mockStat = vi.fn().mockResolvedValue({ size: 44 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = { spawn: vi.fn(() => mockProc), stat: mockStat };

    const controller = startRecording('/tmp/test.wav', deps);

    expect(mockStat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockStat).toHaveBeenCalledWith('/tmp/test.wav');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No audio detected'));
    expect(controller.hasWarned()).toBe(true);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  test('does not warn when audio data is present', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    const mockStat = vi.fn().mockResolvedValue({ size: 32044 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = { spawn: vi.fn(() => mockProc), stat: mockStat };

    const controller = startRecording('/tmp/test.wav', deps);

    await vi.advanceTimersByTimeAsync(2000);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(controller.hasWarned()).toBe(false);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  test('skips mic check when stat is not provided', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    const deps = { spawn: vi.fn(() => mockProc) };

    const controller = startRecording('/tmp/test.wav', deps);

    expect(controller.micWarningTimer).toBeNull();

    vi.useRealTimers();
  });
});

describe('stopRecording', () => {
  test('sends SIGTERM to the process', async () => {
    const mockProc = makeMockProcess();
    const controller = {
      process: mockProc,
      audioStartEpoch: 1000,
      outputPath: '/tmp/test.wav',
      micWarningTimer: null,
    };

    const result = await stopRecording(controller);

    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.audioStartEpoch).toBe(1000);
    expect(result.outputPath).toBe('/tmp/test.wav');
  });

  test('returns immediately if process already exited', async () => {
    const mockProc = makeMockProcess(0);
    const controller = {
      process: mockProc,
      audioStartEpoch: 1000,
      outputPath: '/tmp/test.wav',
      micWarningTimer: null,
    };

    const result = await stopRecording(controller);

    expect(mockProc.kill).not.toHaveBeenCalled();
    expect(result.audioStartEpoch).toBe(1000);
  });

  test('clears mic warning timer on stop', async () => {
    const mockProc = makeMockProcess();
    const timer = setTimeout(() => {}, 10000);
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const controller = {
      process: mockProc,
      audioStartEpoch: 1000,
      outputPath: '/tmp/test.wav',
      micWarningTimer: timer,
    };

    await stopRecording(controller);

    expect(clearSpy).toHaveBeenCalledWith(timer);
    clearSpy.mockRestore();
  });

  test('sends SIGKILL after timeout if process does not exit', async () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    proc.exitCode = null;
    proc.kill = vi.fn((signal) => {
      if (signal === 'SIGKILL') {
        proc.exitCode = 0;
        proc.emit('exit', 0);
      }
      // SIGTERM does not cause exit (simulating stuck process)
    });

    const controller = {
      process: proc,
      audioStartEpoch: 1000,
      outputPath: '/tmp/test.wav',
      micWarningTimer: null,
    };

    const resultPromise = stopRecording(controller);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.outputPath).toBe('/tmp/test.wav');

    vi.useRealTimers();
  });
});
