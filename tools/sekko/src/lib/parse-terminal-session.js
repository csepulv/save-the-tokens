import { readFile } from 'fs/promises';
import stripAnsi from 'strip-ansi';

const CMD_START_PATTERN = /<<<SEKKO_CMD_START:(\d+):(.+?)>>>/;
const CMD_END_PATTERN = /<<<SEKKO_CMD_END:(\d+):(\d+)>>>/;
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';
const MARKER_PATTERN = /<<<SEKKO_CMD_(?:START|END):[^>]+>>>/g;

const DEFAULT_HEAD_LINES = 50;
const DEFAULT_TAIL_LINES = 20;

export async function parseTerminalRecording(castPath, deps = {}) {
  const { readFile: readFileFn = readFile } = deps;
  const content = await readFileFn(castPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((l) => JSON.parse(l));
  return { header, events };
}

export function extractCommands(events) {
  const outputText = events
    .filter(([, type]) => type === 'o')
    .map(([, , data]) => data)
    .join('');

  const commands = [];
  let currentCommand = null;

  const chunks = outputText.split(/(<<<SEKKO_CMD_(?:START|END):[^>]+>>>)/);

  for (const chunk of chunks) {
    const startMatch = chunk.match(CMD_START_PATTERN);
    if (startMatch) {
      currentCommand = {
        command: startMatch[2],
        startMs: parseInt(startMatch[1], 10),
        endMs: null,
        exitCode: null,
        rawOutput: '',
      };
      continue;
    }

    const endMatch = chunk.match(CMD_END_PATTERN);
    if (endMatch) {
      if (currentCommand) {
        currentCommand.endMs = parseInt(endMatch[1], 10);
        currentCommand.exitCode = parseInt(endMatch[2], 10);
        currentCommand.durationMs = currentCommand.endMs - currentCommand.startMs;
        commands.push(currentCommand);
      }
      currentCommand = null;
      continue;
    }

    if (currentCommand) {
      currentCommand.rawOutput += chunk;
    }
  }

  return commands.map((cmd) => ({
    ...cmd,
    output: cleanCommandOutput(cmd.rawOutput, cmd.command),
    rawOutput: undefined,
  }));
}

export function cleanCommandOutput(rawOutput, command) {
  let cleaned = stripAnsi(rawOutput);
  cleaned = cleaned.replace(MARKER_PATTERN, '');
  // Remove the echoed command itself (shell echoes input)
  const commandEcho = command + '\r\n';
  if (cleaned.startsWith(commandEcho)) {
    cleaned = cleaned.slice(commandEcho.length);
  }
  return cleaned.trim();
}

export function detectInteractiveSession(rawOutput) {
  return rawOutput.includes(ALT_SCREEN_ENTER) && rawOutput.includes(ALT_SCREEN_EXIT);
}

export function summarizeInteractiveSession(command, durationMs) {
  const seconds = Math.round(durationMs / 1000);
  return `[interactive: ${command}, duration ${seconds}s]`;
}

export function truncateOutput(text, { headLines = DEFAULT_HEAD_LINES, tailLines = DEFAULT_TAIL_LINES } = {}) {
  const lines = text.split('\n');
  if (lines.length <= headLines + tailLines) return text;

  const truncated = lines.length - headLines - tailLines;
  return [
    ...lines.slice(0, headLines),
    `[... ${truncated} lines truncated ...]`,
    ...lines.slice(-tailLines),
  ].join('\n');
}
