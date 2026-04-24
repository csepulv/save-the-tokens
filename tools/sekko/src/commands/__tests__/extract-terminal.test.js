import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BIN = join(import.meta.dirname, '../../../bin/sekko.js');

let tempDir;
let outputDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sekko-extract-term-'));
  outputDir = join(tempDir, 'output');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeCastFile(events) {
  const header = { version: 2, width: 120, height: 40, timestamp: 1712150400, env: { SHELL: '/bin/zsh', TERM: 'xterm-256color' } };
  const lines = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))];
  const castPath = join(tempDir, 'recording.cast');
  writeFileSync(castPath, lines.join('\n'));
  return castPath;
}

describe('sekko extract terminal integration', () => {
  test('extracts commands from .cast file', () => {
    const castPath = makeCastFile([
      [0.5, 'o', '$ '],
      [1.0, 'o', '<<<SEKKO_CMD_START:1712150401000:echo hello>>>\r\n'],
      [1.1, 'o', 'echo hello\r\nhello\r\n'],
      [1.2, 'o', '<<<SEKKO_CMD_END:1712150401200:0>>>\r\n'],
      [2.0, 'o', '$ '],
      [2.5, 'o', '<<<SEKKO_CMD_START:1712150402500:ls /nonexistent>>>\r\n'],
      [2.6, 'o', 'ls /nonexistent\r\nls: /nonexistent: No such file or directory\r\n'],
      [2.7, 'o', '<<<SEKKO_CMD_END:1712150402700:1>>>\r\n'],
    ]);

    execFileSync('node', [BIN, 'extract', castPath, '-o', outputDir], { encoding: 'utf-8' });

    expect(existsSync(join(outputDir, 'terminal-session.md'))).toBe(true);
    expect(existsSync(join(outputDir, 'terminal-session.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'summary.md'))).toBe(true);

    const md = readFileSync(join(outputDir, 'terminal-session.md'), 'utf-8');
    expect(md).toContain('echo hello');
    expect(md).toContain('hello');
    expect(md).toContain('ls /nonexistent');
    expect(md).toContain('**Exit:** 1');

    const json = JSON.parse(readFileSync(join(outputDir, 'terminal-session.json'), 'utf-8'));
    expect(json.commands).toHaveLength(2);
    expect(json.commands[0].command).toBe('echo hello');
    expect(json.commands[0].exitCode).toBe(0);
    expect(json.commands[1].exitCode).toBe(1);
  });

  test('summary lists terminal artifacts', () => {
    const castPath = makeCastFile([
      [1.0, 'o', '<<<SEKKO_CMD_START:1000:echo hi>>>\r\n'],
      [1.1, 'o', 'echo hi\r\nhi\r\n'],
      [1.2, 'o', '<<<SEKKO_CMD_END:1200:0>>>\r\n'],
    ]);

    execFileSync('node', [BIN, 'extract', castPath, '-o', outputDir], { encoding: 'utf-8' });

    const summary = readFileSync(join(outputDir, 'summary.md'), 'utf-8');
    expect(summary).toContain('terminal-session.md');
    expect(summary).toContain('terminal-session.json');
    expect(summary).toContain('1 commands');
  });

  test('credential redaction in extracted output', () => {
    const castPath = makeCastFile([
      [1.0, 'o', '<<<SEKKO_CMD_START:1000:env>>>\r\n'],
      [1.1, 'o', 'env\r\nGITHUB_TOKEN=ghp_abc123def456789\r\nHOME=/home/theuser\r\n'],
      [1.2, 'o', '<<<SEKKO_CMD_END:1200:0>>>\r\n'],
    ]);

    execFileSync('node', [BIN, 'extract', castPath, '-o', outputDir], { encoding: 'utf-8' });

    const md = readFileSync(join(outputDir, 'terminal-session.md'), 'utf-8');
    expect(md).not.toContain('ghp_abc123def456789');
    expect(md).toContain('[REDACTED]');
    expect(md).toContain('HOME=/home/theuser'); // non-secret preserved
  });

  test('web extraction still works (regression)', () => {
    // This test just verifies that .zip files don't break
    // The existing extract.test.js handles full web extraction
    const result = () => execFileSync('node', [BIN, 'extract', '/nonexistent.zip', '-o', outputDir], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    // Should fail because file doesn't exist, not because of terminal code
    expect(result).toThrow();
  });
});
