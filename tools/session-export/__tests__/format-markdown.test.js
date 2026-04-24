import { test, expect } from 'vitest';
import { formatMarkdown } from '../lib/format-markdown.js';
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

// --- Structure tests ---

test('uses horizontal rules and bold labels instead of heading-based sections', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv);

  expect(result).toContain('---\n\n**User**\n\nhello');
  expect(result).toContain('---\n\n**Assistant**\n\nhi there');
  expect(result).not.toContain('## User');
  expect(result).not.toContain('## Assistant');
});

test('preserves frontmatter and title heading', () => {
  const conv = makeConversation({ metadata: { customTitle: 'My Session' } });
  const result = formatMarkdown(conv);

  expect(result.startsWith('---\n')).toBe(true);
  expect(result).toContain('session: test-session-id');
  expect(result).toContain('# My Session');
});

test('uses session ID as title when no custom title', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv);

  expect(result).toContain('# test-session-id');
});

// --- Merge tests ---

test('merges consecutive assistant messages into one section', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['do something'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: [], toolCalls: ['[Bash: ls]'], toolResults: [], thinking: [] },
      { role: 'user', text: [], toolCalls: [], toolResults: [{ toolName: 'Bash', content: 'file.txt' }], thinking: [] },
      { role: 'assistant', text: ['Here are the files'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeTools: true });

  // Should have exactly one **Assistant** label
  const assistantCount = (result.match(/\*\*Assistant\*\*/g) || []).length;
  expect(assistantCount).toBe(1);

  // The merged section should have both the tool call and the text
  expect(result).toContain('[Bash: ls]');
  expect(result).toContain('Here are the files');
});

// --- Tool call tests ---

test('excludes tool calls by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['do something'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['done'], toolCalls: ['[Bash: ls -la]'], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv);

  expect(result).not.toContain('Bash');
  expect(result).toContain('done');
});

test('renders tool calls as details/summary with includeTools', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['do something'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['done'], toolCalls: ['[Bash: ls -la]'], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeTools: true });

  expect(result).toContain('<details>');
  expect(result).toContain('<summary><code>[Bash: ls -la]</code></summary>');
  expect(result).toContain('</details>');
});

test('includes tool results inside details block with includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['list files'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['here they are'], toolCalls: ['[Bash: ls]'], toolResults: [{ toolName: 'Bash', content: 'file1.txt\nfile2.txt' }], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });

  // Tool result should be inside the details block as a fenced code block
  expect(result).toContain('<summary><code>[Bash: ls]</code></summary>');
  expect(result).toContain('file1.txt\nfile2.txt');
  expect(result).toContain('```');
});

// --- Thinking tests ---

test('renders thinking blocks as collapsible details with includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['explain monads'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['A monad is...'], toolCalls: [], toolResults: [], thinking: ['Let me think about this...'] },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });

  expect(result).toContain('<details>');
  expect(result).toContain('<summary>Thinking</summary>');
  expect(result).toContain('Let me think about this...');
  expect(result).toContain('</details>');
});

test('excludes thinking blocks by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['explain'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['answer'], toolCalls: [], toolResults: [], thinking: ['deep thought'] },
    ],
  });
  const result = formatMarkdown(conv);

  expect(result).not.toContain('Thinking');
  expect(result).not.toContain('deep thought');
});

// --- System message tests ---

test('skips system messages by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'system', subtype: 'local_command', text: ['session renamed'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv);

  expect(result).not.toContain('System');
  expect(result).not.toContain('session renamed');
});

test('renders system messages as italic with includeSystem', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'system', subtype: 'local_command', text: ['session renamed'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeSystem: true });

  expect(result).toContain('*System: session renamed*');
});

test('renders system messages as details block with includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'system', subtype: 'local_command', text: ['session renamed'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });

  expect(result).toContain('<details>');
  expect(result).toContain('<summary>System</summary>');
  expect(result).toContain('session renamed');
});

// --- Subagent tests ---

test('renders subagent blocks as collapsible details with includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['find files'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'subagent', agentPrompt: 'Find .js files', agentId: 'agent-1', text: ['Found 3 files'], toolCalls: ['[Glob: *.js]'], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['Here are the results'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });

  expect(result).toContain('<details>');
  expect(result).toContain('<summary>Subagent: Find .js files</summary>');
  expect(result).toContain('Found 3 files');
});

test('skips subagent blocks when not includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['find files'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'subagent', agentPrompt: 'Find .js files', agentId: 'agent-1', text: ['Found 3 files'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['Here are the results'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv);

  expect(result).not.toContain('Subagent');
});

// --- User message filtering ---

test('skips user messages with only tool results when not includeAll', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: [], toolCalls: ['[Read: foo.js]'], toolResults: [], thinking: [] },
      { role: 'user', text: [], toolCalls: [], toolResults: [{ toolName: 'Read', content: 'file contents' }], thinking: [] },
      { role: 'assistant', text: ['I see the file'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeTools: true });

  // After merge, the tool result is absorbed into the assistant message
  expect(result).not.toContain('Result for Read');
  expect(result).toContain('I see the file');
});

// --- End-to-end with real fixtures ---

test('end-to-end: basic fixture produces clean transcript', async () => {
  const conv = await parseConversation(fixture('basic.jsonl'));
  const result = formatMarkdown(conv);

  // Structural checks
  expect(result.startsWith('---\n')).toBe(true);
  expect(result).toContain('**User**');
  expect(result).toContain('**Assistant**');
  expect(result).not.toContain('## User');
  expect(result).toContain('tell me a joke');
});

test('end-to-end: with-tools fixture merges tool turns', async () => {
  const conv = await parseConversation(fixture('with-tools.jsonl'));
  const result = formatMarkdown(conv, { includeTools: true });

  // Should have tool calls in details blocks
  expect(result).toContain('<details>');
  expect(result).toContain('[Bash:');

  // Each assistant turn should appear once (merged)
  const assistantCount = (result.match(/\*\*Assistant\*\*/g) || []).length;
  expect(assistantCount).toBe(2); // Two Q&A turns
});

test('end-to-end: with-title fixture uses custom title', async () => {
  const conv = await parseConversation(fixture('with-title-and-plan-mode.jsonl'));
  const result = formatMarkdown(conv);

  expect(result).toContain('# claude-sessions-fixtures-enable-plan-mode');
  expect(result).toContain('title: claude-sessions-fixtures-enable-plan-mode');
});

test('end-to-end: with-subagents fixture includes subagent content', async () => {
  const conv = await parseConversation(fixture('with-subagents-and-system.jsonl'));
  const result = formatMarkdown(conv, { includeAll: true });

  expect(result).toContain('<summary>Subagent:');
  expect(result).toContain('<summary>System</summary>');
});

// --- Frontmatter include flags ---

test('includes include_all in frontmatter when includeAll is set', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv, { includeAll: true });

  expect(result).toContain('include_all: true');
  expect(result).not.toContain('include_tools:');
  expect(result).not.toContain('include_system:');
});

test('includes include_tools in frontmatter when includeTools is set', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv, { includeTools: true });

  expect(result).toContain('include_tools: true');
  expect(result).not.toContain('include_all:');
});

test('omits include flags from frontmatter when not set', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv);

  expect(result).not.toContain('include_tools');
  expect(result).not.toContain('include_system');
  expect(result).not.toContain('include_all');
});

// --- Timestamp tests ---

test('omits per-message timestamps by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:15:17.000Z' },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:00:30.000Z' },
    ],
  });
  const result = formatMarkdown(conv);
  expect(result).not.toContain('2026-04-04T00:15:17.000Z');
  expect(result).toContain('**User**\n\nhello');
});

test('renders per-message timestamps with includeTimestamps', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:15:17.000Z' },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:00:30.000Z' },
    ],
  });
  const result = formatMarkdown(conv, { includeTimestamps: true });
  expect(result).toContain('**User** · _2026-04-04T00:15:17.000Z_');
  expect(result).toContain('**Assistant** · _2026-04-04T00:00:30.000Z_');
});

test('includeAll implies includeTimestamps', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:15:17.000Z' },
      { role: 'assistant', text: ['hi'], toolCalls: [], toolResults: [], thinking: [], timestamp: '2026-04-04T00:00:30.000Z' },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });
  expect(result).toContain('**User** · _2026-04-04T00:15:17.000Z_');
});

test('includes duration in frontmatter', () => {
  const conv = makeConversation();
  const result = formatMarkdown(conv);
  expect(result).toContain('duration: 1h');
});

test('omits duration when startedAt or endedAt missing', () => {
  const conv = makeConversation({ metadata: { endedAt: null } });
  const result = formatMarkdown(conv);
  expect(result).not.toContain('duration:');
});

// --- Content parity test ---

test('content parity: same text content regardless of format options', async () => {
  const conv = await parseConversation(fixture('with-tools.jsonl'));

  const defaultOutput = formatMarkdown(conv);
  const toolsOutput = formatMarkdown(conv, { includeTools: true });

  // Strip all markdown formatting
  const stripMarkdown = (s) => s
    .replace(/^---[\s\S]*?---\n/m, '') // frontmatter
    .replace(/<details>[\s\S]*?<\/details>/g, '') // details blocks
    .replace(/\*\*\w+\*\*/g, '') // bold labels
    .replace(/^---$/gm, '') // horizontal rules
    .replace(/^#.*/gm, '') // headings
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/\n{2,}/g, '\n')
    .trim();

  const defaultText = stripMarkdown(defaultOutput);
  const toolsText = stripMarkdown(toolsOutput);

  // Default text should be a subset of tools text (tools adds content, doesn't remove)
  expect(toolsText).toContain(defaultText);
});

// --- Skill text tests ---

const skillBody = 'Base directory for this skill: /foo/skills/bar\n\n# Bar Skill\n\nFull body goes on for many lines.\n\n## Section\n\ncontent';

test('truncates skill bodies in user messages by default', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: [skillBody], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['ok'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv);
  expect(result).toContain('Base directory for this skill: /foo/skills/bar\n# Bar Skill');
  expect(result).not.toContain('Full body goes on for many lines');
});

test('preserves full skill body with includeSkillText', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: [skillBody], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['ok'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeSkillText: true });
  expect(result).toContain('Full body goes on for many lines');
  expect(result).toContain('## Section');
});

test('includeAll does NOT imply includeSkillText', () => {
  const conv = makeConversation({
    messages: [
      { role: 'user', text: [skillBody], toolCalls: [], toolResults: [], thinking: [] },
      { role: 'assistant', text: ['ok'], toolCalls: [], toolResults: [], thinking: [] },
    ],
  });
  const result = formatMarkdown(conv, { includeAll: true });
  expect(result).not.toContain('Full body goes on for many lines');
});
