import { test, expect, describe } from 'vitest';
import { extractCommands, cleanCommandOutput, detectInteractiveSession, summarizeInteractiveSession, truncateOutput } from '../parse-terminal-session.js';

function makeEvents(outputChunks) {
  let time = 0.5;
  return outputChunks.map((text) => {
    time += 0.1;
    return [time, 'o', text];
  });
}

describe('extractCommands', () => {
  test('extracts a single command with output and exit code', () => {
    const events = makeEvents([
      '$ ',
      '<<<SEKKO_CMD_START:1000:echo hello>>>\r\n',
      'echo hello\r\nhello\r\n',
      '<<<SEKKO_CMD_END:1200:0>>>\r\n',
      '$ ',
    ]);

    const commands = extractCommands(events);
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe('echo hello');
    expect(commands[0].startMs).toBe(1000);
    expect(commands[0].endMs).toBe(1200);
    expect(commands[0].exitCode).toBe(0);
    expect(commands[0].durationMs).toBe(200);
    expect(commands[0].output).toContain('hello');
  });

  test('extracts multiple commands', () => {
    const events = makeEvents([
      '<<<SEKKO_CMD_START:1000:echo one>>>\r\n',
      'echo one\r\none\r\n',
      '<<<SEKKO_CMD_END:1100:0>>>\r\n',
      '<<<SEKKO_CMD_START:1200:echo two>>>\r\n',
      'echo two\r\ntwo\r\n',
      '<<<SEKKO_CMD_END:1300:0>>>\r\n',
    ]);

    const commands = extractCommands(events);
    expect(commands).toHaveLength(2);
    expect(commands[0].command).toBe('echo one');
    expect(commands[1].command).toBe('echo two');
  });

  test('captures non-zero exit codes', () => {
    const events = makeEvents([
      '<<<SEKKO_CMD_START:1000:false>>>\r\n',
      'false\r\n',
      '<<<SEKKO_CMD_END:1100:1>>>\r\n',
    ]);

    const commands = extractCommands(events);
    expect(commands[0].exitCode).toBe(1);
  });

  test('handles commands with no output', () => {
    const events = makeEvents([
      '<<<SEKKO_CMD_START:1000:cd /tmp>>>\r\n',
      'cd /tmp\r\n',
      '<<<SEKKO_CMD_END:1050:0>>>\r\n',
    ]);

    const commands = extractCommands(events);
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe('cd /tmp');
    // Output is just the echoed command, which gets cleaned
  });

  test('returns empty array when no markers present', () => {
    const events = makeEvents(['$ ls\r\n', 'file1 file2\r\n']);
    const commands = extractCommands(events);
    expect(commands).toEqual([]);
  });
});

describe('cleanCommandOutput', () => {
  test('strips ANSI escape codes', () => {
    const result = cleanCommandOutput('\x1b[31mred text\x1b[0m', 'echo');
    expect(result).toBe('red text');
  });

  test('removes sekko markers', () => {
    const result = cleanCommandOutput('hello\n<<<SEKKO_CMD_END:1000:0>>>\nworld', 'echo');
    expect(result).toBe('hello\n\nworld');
  });

  test('removes echoed command', () => {
    const result = cleanCommandOutput('ls -la\r\ntotal 48\r\nfile1', 'ls -la');
    expect(result).toBe('total 48\r\nfile1');
  });
});

describe('detectInteractiveSession', () => {
  test('detects alternate screen buffer enter and exit', () => {
    expect(detectInteractiveSession('before\x1b[?1049hscreen content\x1b[?1049lafter')).toBe(true);
  });

  test('returns false for normal output', () => {
    expect(detectInteractiveSession('just normal text')).toBe(false);
  });

  test('returns false with only enter, no exit', () => {
    expect(detectInteractiveSession('text\x1b[?1049hmore text')).toBe(false);
  });
});

describe('summarizeInteractiveSession', () => {
  test('formats command and duration', () => {
    expect(summarizeInteractiveSession('vim test.txt', 45000)).toBe('[interactive: vim test.txt, duration 45s]');
  });
});

describe('truncateOutput', () => {
  test('returns short text unchanged', () => {
    const text = 'line1\nline2\nline3';
    expect(truncateOutput(text)).toBe(text);
  });

  test('truncates long text with head + marker + tail', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');

    const result = truncateOutput(text, { headLines: 5, tailLines: 3 });
    const resultLines = result.split('\n');

    expect(resultLines[0]).toBe('line 1');
    expect(resultLines[4]).toBe('line 5');
    expect(resultLines[5]).toBe('[... 192 lines truncated ...]');
    expect(resultLines[6]).toBe('line 198');
    expect(resultLines[8]).toBe('line 200');
  });

  test('uses default head=50, tail=20', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const result = truncateOutput(lines.join('\n'));
    expect(result).toContain('[... 130 lines truncated ...]');
  });
});
