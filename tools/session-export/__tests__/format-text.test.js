import { test, expect } from 'vitest';
import { formatText } from '../lib/format-text.js';
import { parseConversation } from '../lib/parse.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, 'fixtures', name);

function makeConversation(overrides = {}) {
  return {
    metadata: {
      sessionId: 'test-session-id',
      project: 'myapp',
      customTitle: null,
      sourcePath: '/test/path.jsonl',
      exportDate: '2026-04-04T00:00:00.000Z',
      hostname: 'test-host',
      cwd: '/Users/test/projects/myapp',
      gitBranch: 'main',
      claudeVersion: '2.1.38',
      permissionMode: 'default',
      startedAt: '2026-04-04T00:00:00.000Z',
      endedAt: '2026-04-04T01:00:00.000Z',
      ...overrides.metadata,
    },
    messages: overrides.messages ?? [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi there'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  };
}

test('formats messages with === headers', () => {
  const conv = makeConversation();
  const result = formatText(conv);

  expect(result).toContain('=== USER ===');
  expect(result).toContain('hello');
  expect(result).toContain('=== ASSISTANT ===');
  expect(result).toContain('hi there');
});

test('includes frontmatter', () => {
  const conv = makeConversation();
  const result = formatText(conv);

  expect(result.startsWith('---\n')).toBe(true);
  expect(result).toContain('session: test-session-id');
});

test('excludes tool calls by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['do something'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['done'], toolCalls: ['[Bash: ls -la]'], toolResults: [], thinking: [] },
    ],
  });
  const result = formatText(conv);

  expect(result).not.toContain('[Bash:');
});

test('includes tool calls with includeTools', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['do something'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['done'], toolCalls: ['[Bash: ls -la]'], toolResults: [], thinking: [] },
    ],
  });
  const result = formatText(conv, { includeTools: true });

  expect(result).toContain('  [Bash: ls -la]');
});

test('includes thinking and tool results with includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['explain'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['A monad is...'], toolCalls: [], toolResults: [], thinking: ['Let me think...'] },
    ],
  });
  const result = formatText(conv, { includeAll: true });

  expect(result).toContain('[Thinking: Let me think...]');
});

test('skips system messages by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'system', subtype: 'local_command', text: ['/color blue'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatText(conv);

  expect(result).not.toContain('=== SYSTEM ===');
});

test('includes system messages with includeSystem', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'system', subtype: 'local_command', text: ['/color blue'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatText(conv, { includeSystem: true });

  expect(result).toContain('=== SYSTEM ===');
  expect(result).toContain('/color blue');
});

test('formats subagent blocks with indentation', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['find files'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'subagent', agentPrompt: 'Find .js files', agentId: 'a1', text: ['Found 3 files'], toolCalls: ['[Glob: *.js]'], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['Here are the results'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatText(conv, { includeAll: true });

  expect(result).toContain('  --- Subagent: Find .js files ---');
  expect(result).toContain('    Found 3 files');
  expect(result).toContain('    [Glob: *.js]');
  expect(result).toContain('  --- End Subagent ---');
});

test('end-to-end: formats real basic fixture as text', async () => {
  const conv = await parseConversation(fixture('basic.jsonl'));
  const result = formatText(conv);

  expect(result).toContain('=== USER ===');
  expect(result).toContain('tell me a joke');
  expect(result).toContain('=== ASSISTANT ===');
});

test('omits per-message timestamps by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:15:17.000Z' },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:00:30.000Z' },
    ],
  });
  const result = formatText(conv);
  expect(result).toContain('=== USER ===');
  expect(result).not.toContain('=== USER [');
});

test('renders per-message timestamps with includeTimestamps', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:15:17.000Z' },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:00:30.000Z' },
    ],
  });
  const result = formatText(conv, { includeTimestamps: true });
  expect(result).toContain('=== USER [2026-04-04T00:15:17.000Z] ===');
  expect(result).toContain('=== ASSISTANT [2026-04-04T00:00:30.000Z] ===');
});

test('includes duration in frontmatter', () => {
  const conv = makeConversation();
  const result = formatText(conv);
  expect(result).toContain('duration: 1h');
});
