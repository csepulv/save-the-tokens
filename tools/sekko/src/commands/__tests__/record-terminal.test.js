import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BIN = join(import.meta.dirname, '../../../bin/sekko.js');

let outputDir;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'sekko-terminal-test-'));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

function runRecordTerminal(args = [], { commands = [], timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN, 'record-terminal', '-o', outputDir, ...args], {
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    // Wait for shell to be ready then send commands
    let commandIndex = 0;
    const sendNextCommand = () => {
      if (commandIndex < commands.length) {
        proc.stdin.write(commands[commandIndex] + '\r');
        commandIndex++;
        setTimeout(sendNextCommand, 300);
      }
    };
    setTimeout(sendNextCommand, 1500);

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Test timed out'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseCastFile() {
  const castPath = join(outputDir, 'recording.cast');
  if (!existsSync(castPath)) return null;
  const content = readFileSync(castPath, 'utf-8').trim();
  const lines = content.split('\n').map((l) => JSON.parse(l));
  return {
    header: lines[0],
    events: lines.slice(1),
    raw: content,
  };
}

describe('sekko record-terminal integration', () => {
  test('scripted session produces valid asciicast with markers', async () => {
    const { code } = await runRecordTerminal([], {
      commands: ['echo SEKKO_TEST_HELLO', 'exit'],
    });

    expect(code).toBe(0);

    const cast = parseCastFile();
    expect(cast).not.toBeNull();

    // Valid header
    expect(cast.header.version).toBe(2);
    expect(typeof cast.header.width).toBe('number');
    expect(typeof cast.header.height).toBe('number');
    expect(typeof cast.header.timestamp).toBe('number');

    // Events are valid arrays
    for (const event of cast.events) {
      expect(Array.isArray(event)).toBe(true);
      expect(event).toHaveLength(3);
      expect(typeof event[0]).toBe('number');
      expect(['o', 'i', 'r']).toContain(event[1]);
    }

    // Output contains our test command's output
    const outputText = cast.events
      .filter(([, type]) => type === 'o')
      .map(([, , data]) => data)
      .join('');
    expect(outputText).toContain('SEKKO_TEST_HELLO');

    // Markers are present
    expect(outputText).toContain('<<<SEKKO_CMD_START:');
    expect(outputText).toContain('<<<SEKKO_CMD_END:');
  }, 20000);

  test('markers contain timestamps and command text', async () => {
    await runRecordTerminal([], {
      commands: ['echo marker_test_123', 'exit'],
    });

    const cast = parseCastFile();
    const outputText = cast.events
      .filter(([, type]) => type === 'o')
      .map(([, , data]) => data)
      .join('');

    // Find a CMD_START marker and verify format
    const startMatch = outputText.match(/<<<SEKKO_CMD_START:(\d+):(.+?)>>>/);
    expect(startMatch).not.toBeNull();
    const timestamp = parseInt(startMatch[1], 10);
    expect(timestamp).toBeGreaterThan(1700000000000); // reasonable epoch ms

    // Find a CMD_END marker and verify format
    const endMatch = outputText.match(/<<<SEKKO_CMD_END:(\d+):(\d+)>>>/);
    expect(endMatch).not.toBeNull();
    const exitCode = parseInt(endMatch[2], 10);
    expect(exitCode).toBe(0);
  }, 20000);

  test('captures non-zero exit codes', async () => {
    await runRecordTerminal([], {
      commands: ['false', 'exit'],
    });

    const cast = parseCastFile();
    const outputText = cast.events
      .filter(([, type]) => type === 'o')
      .map(([, , data]) => data)
      .join('');

    // Should have a CMD_END with exit code 1
    const endMatches = [...outputText.matchAll(/<<<SEKKO_CMD_END:(\d+):(\d+)>>>/g)];
    const exitCodes = endMatches.map((m) => parseInt(m[2], 10));
    expect(exitCodes).toContain(1);
  }, 20000);

  test('exit ends session cleanly', async () => {
    const { code } = await runRecordTerminal([], {
      commands: ['exit'],
    });

    expect(code).toBe(0);
    expect(existsSync(join(outputDir, 'recording.cast'))).toBe(true);
  }, 20000);
});
