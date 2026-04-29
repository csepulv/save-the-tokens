import { test, expect, describe } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { spawn } from 'child_process';

const BIN = resolve(import.meta.dirname, '../../../bin/sekko.js');

function spawnSekko(args, env = {}) {
  return spawn('node', [BIN, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

function waitForOutput(child, predicate, timeoutMs = 20_000) {
  return new Promise((resolvePromise, reject) => {
    let buffer = '';
    let resolved = false;
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (!resolved && predicate(buffer)) {
        resolved = true;
        cleanup();
        resolvePromise(buffer);
      }
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Timeout waiting for output. Buffer:\n${buffer}`));
      }
    }, timeoutMs);
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

function waitForExit(child, timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Subprocess did not exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
}

describe('stop signals', () => {
  test('SIGINT triggers save-and-exit; trace.zip is produced', async () => {
    const port = 9244;
    const debugProfile = mkdtempSync(join(tmpdir(), 'sekko-sig-debug-'));
    const recordingDir = mkdtempSync(join(tmpdir(), 'sekko-sig-recording-'));

    let debugContext = null;
    let sekko = null;

    try {
      const { chromium } = await import('playwright');
      debugContext = await chromium.launchPersistentContext(debugProfile, {
        headless: true,
        args: [`--remote-debugging-port=${port}`],
      });

      sekko = spawnSekko([
        'record-web',
        'https://example.com/',
        '--connect',
        `http://localhost:${port}`,
        '--output',
        recordingDir,
      ]);

      // Wait for sekko to navigate (look for the "Recording trace —" line)
      await waitForOutput(sekko, (buf) => buf.includes('Recording trace'));

      // Give the page a moment to settle and the poller to do at least one cycle
      await new Promise((r) => setTimeout(r, 800));

      sekko.kill('SIGINT');
      const { code } = await waitForExit(sekko);

      // Successful save flow exits 0
      expect(code).toBe(0);

      // Artifacts present
      expect(existsSync(join(recordingDir, 'trace.zip'))).toBe(true);
      expect(existsSync(join(recordingDir, 'user-events.json'))).toBe(true);

      // Connect mode does not produce HAR
      expect(existsSync(join(recordingDir, 'recording.har'))).toBe(false);

      // user-events.json is valid JSON
      const events = JSON.parse(readFileSync(join(recordingDir, 'user-events.json'), 'utf-8'));
      expect(Array.isArray(events)).toBe(true);

      // Debug Chromium is still running (sekko detached, didn't kill it)
      expect(debugContext.pages().length).toBeGreaterThan(0);
    } finally {
      if (sekko && !sekko.killed) {
        sekko.kill('SIGKILL');
      }
      if (debugContext) await debugContext.close();
      rmSync(debugProfile, { recursive: true, force: true });
      rmSync(recordingDir, { recursive: true, force: true });
    }
  }, 60_000);

});
