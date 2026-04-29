import { test, expect, describe, vi } from 'vitest';
import { EventEmitter } from 'events';
import { startSystemScreencap } from '../system-screencap.js';

function makeFakeChild(exitCode = 0) {
  const child = new EventEmitter();
  setImmediate(() => child.emit('exit', exitCode));
  return child;
}

describe('startSystemScreencap', () => {
  test('captures one frame immediately on start', () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 10000, // long so only initial frame fires within test
      deps: { spawn, now: () => 1000 },
    });
    controller.stop();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('spawns screencapture with full-display args when no region', () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 60_000,
      deps: { spawn, now: () => 12345 },
    });
    controller.stop();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/sbin/screencapture',
      ['-t', 'jpg', '-x', '/tmp/test/screen-12345.jpg'],
      { stdio: 'ignore' }
    );
  });

  test('passes -R bounds when region is given', () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 60_000,
      region: { x: 10, y: 20, w: 1280, h: 800 },
      deps: { spawn, now: () => 999 },
    });
    controller.stop();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/sbin/screencapture',
      ['-t', 'jpg', '-x', '-R', '10,20,1280,800', '/tmp/test/screen-999.jpg'],
      { stdio: 'ignore' }
    );
  });

  test('falls back to full-display when region has zero dimensions', () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 60_000,
      region: { x: 0, y: 0, w: 0, h: 0 },
      deps: { spawn, now: () => 1 },
    });
    controller.stop();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/sbin/screencapture',
      ['-t', 'jpg', '-x', '/tmp/test/screen-1.jpg'],
      { stdio: 'ignore' }
    );
  });

  test('updateRegion changes args on next capture', async () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 30,
      region: { x: 0, y: 0, w: 100, h: 100 },
      deps: { spawn, now: () => 1 },
    });
    controller.updateRegion({ x: 50, y: 60, w: 200, h: 200 });
    await new Promise((r) => setTimeout(r, 50));
    controller.stop();
    const calls = spawn.mock.calls;
    // First call used original region; later call should reflect updated region
    const updatedCall = calls.find((c) => c[1].includes('50,60,200,200'));
    expect(updatedCall).toBeTruthy();
  });

  test('captures multiple frames over time', async () => {
    const spawn = vi.fn(() => makeFakeChild());
    let counter = 0;
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 30,
      deps: { spawn, now: () => 1000 + (counter++) },
    });
    await new Promise((r) => setTimeout(r, 100));
    controller.stop();
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('throws without outputDir', () => {
    expect(() => startSystemScreencap({})).toThrow(/outputDir is required/);
  });

  test('counts only successful captures', async () => {
    const spawn = vi.fn(() => makeFakeChild(1)); // non-zero exit code
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 60_000,
      deps: { spawn, now: () => 1000 },
    });
    await new Promise((r) => setTimeout(r, 30));
    controller.stop();
    expect(controller.getCount()).toBe(0);
  });

  test('survives spawn errors silently', () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('error', new Error('not found')));
      return child;
    });
    expect(() => {
      const c = startSystemScreencap({
        outputDir: '/tmp/test',
        intervalMs: 60_000,
        deps: { spawn, now: () => 1000 },
      });
      c.stop();
    }).not.toThrow();
  });

  test('stop prevents further captures', async () => {
    const spawn = vi.fn(() => makeFakeChild());
    const controller = startSystemScreencap({
      outputDir: '/tmp/test',
      intervalMs: 10,
      deps: { spawn, now: () => 1000 },
    });
    controller.stop();
    const callsAtStop = spawn.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(spawn.mock.calls.length).toBe(callsAtStop);
  });
});
