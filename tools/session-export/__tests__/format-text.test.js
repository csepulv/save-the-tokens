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

// --- AskUserQuestion rendering ---

function auqConversation() {
  return {
    metadata: {
      sessionId: 'auq-fixture',
      project: 'test',
      customTitle: null,
      sourcePath: '/test.jsonl',
      exportDate: '2026-05-08T12:00:00Z',
      hostname: 'h',
      cwd: '/test',
      gitBranch: 'main',
      claudeVersion: '2.1',
      permissionMode: 'default',
      startedAt: '2026-05-08T12:00:00Z',
      endedAt: '2026-05-08T12:00:05Z',
    },
    messages: [
      { role: 'user', text: ['help me name a thing'], toolCalls: [], toolResults: [], thinking: [] },
      {
        role: 'assistant',
        text: ['Couple of choices to make.'],
        toolCalls: [],
        toolResults: [],
        thinking: [],
        questions: [
          {
            header: 'Casing',
            question: 'Casing?',
            multiSelect: false,
            selected: 'camelCase',
            options: [
              { label: 'camelCase', description: 'Single word, internal capitals.' },
              { label: 'snake_case', description: 'Lowercase with underscores.' },
            ],
          },
        ],
      },
      {
        role: 'user',
        text: [],
        toolCalls: [],
        toolResults: [],
        thinking: [],
        answers: [
          {
            header: 'Casing',
            question: 'Casing?',
            multiSelect: false,
            selected: 'camelCase',
            options: [
              { label: 'camelCase', description: 'Single word, internal capitals.' },
              { label: 'snake_case', description: 'Lowercase with underscores.' },
            ],
          },
        ],
      },
    ],
  };
}

test('AUQ default text: renders Q and A with header', () => {
  const result = formatText(auqConversation());
  expect(result).toContain('Q (Casing): Casing?');
  expect(result).toContain('A (Casing): camelCase');
  expect(result).not.toContain('snake_case');
  expect(result).not.toContain('Single word, internal capitals.');
});

test('AUQ default text: user-with-only-answers turn renders', () => {
  const result = formatText(auqConversation());
  const userBlocks = result.match(/=== USER ===/g) ?? [];
  expect(userBlocks.length).toBe(2);
});

test('AUQ --include-all text: shows full options with selection marked', () => {
  const result = formatText(auqConversation(), { includeAll: true });
  expect(result).toContain('Q (Casing): Casing?');
  expect(result).toContain('camelCase');
  expect(result).toContain('snake_case');
  expect(result).toContain('Single word, internal capitals.');
  // Selected option marked with [x]
  expect(result).toMatch(/\[x\] camelCase/);
  expect(result).toMatch(/\[ \] snake_case/);
  // User-side echo with checkmark
  expect(result).toContain('A (Casing): ✓ camelCase');
});

test('AUQ free-text answer renders Other in text', () => {
  const conv = auqConversation();
  conv.messages[1].questions[0].header = 'Location';
  conv.messages[1].questions[0].question = 'Where should the file live?';
  conv.messages[1].questions[0].selected = 'src/helpers/';
  conv.messages[1].questions[0].notes = 'src/helpers/';
  conv.messages[2].answers[0].header = 'Location';
  conv.messages[2].answers[0].question = 'Where should the file live?';
  conv.messages[2].answers[0].selected = 'src/helpers/';
  conv.messages[2].answers[0].notes = 'src/helpers/';

  const result = formatText(conv);
  expect(result).toMatch(/A \(Location\): Other — "src\/helpers\/"/);
});

test('AUQ from real fixture renders both pairs in text default mode', async () => {
  const conv = await parseConversation(fixture('auq.jsonl'));
  const result = formatText(conv);

  expect(result).toContain('Q (Casing): Casing?');
  expect(result).toContain('A (Casing): camelCase');
  expect(result).toContain('Q (Location): Where should the file live?');
  expect(result).toMatch(/A \(Location\): Other — "src\/helpers\/"/);
});
