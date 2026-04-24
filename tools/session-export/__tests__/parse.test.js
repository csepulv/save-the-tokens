import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConversation, mergeConsecutiveAssistant, transformUserText } from '../lib/parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, 'fixtures', name);

test('parses basic text-only conversation', async () => {
  const result = await parseConversation(fixture('basic.jsonl'));

  expect(result.metadata.sessionId).toBe('3f16bd25-e092-464b-8ea3-1e98382f72c8');
  expect(result.metadata.permissionMode).toBe('default');
  expect(result.metadata.startedAt).toBeTruthy();
  expect(result.metadata.endedAt).toBeTruthy();
  expect(result.metadata.exportDate).toBeTruthy();
  expect(result.metadata.hostname).toBeTruthy();

  // Should have at least one user and one assistant message
  const userMsgs = result.messages.filter((m) => m.role === 'user');
  const asstMsgs = result.messages.filter((m) => m.role === 'assistant');
  expect(userMsgs.length).toBeGreaterThanOrEqual(1);
  expect(asstMsgs.length).toBeGreaterThanOrEqual(1);

  // First user message should be "tell me a joke"
  expect(userMsgs[0].text[0]).toBe('tell me a joke');

  // Assistant should have text response
  expect(asstMsgs[0].text.length).toBeGreaterThan(0);
  expect(asstMsgs[0].toolCalls).toEqual([]);
});

test('parses conversation with tool calls', async () => {
  const result = await parseConversation(fixture('with-tools.jsonl'));

  const asstMsgs = result.messages.filter((m) => m.role === 'assistant');
  const userMsgs = result.messages.filter((m) => m.role === 'user');

  // Should have tool_use in assistant messages
  const msgsWithTools = asstMsgs.filter((m) => m.toolCalls.length > 0);
  expect(msgsWithTools.length).toBeGreaterThan(0);

  // Tool calls should be summarized strings
  const firstToolCall = msgsWithTools[0].toolCalls[0];
  expect(firstToolCall).toMatch(/^\[Bash:/);

  // Should have tool_result in user messages
  const msgsWithResults = userMsgs.filter((m) => m.toolResults.length > 0);
  expect(msgsWithResults.length).toBeGreaterThan(0);

  // Tool results should have toolName and content
  const firstResult = msgsWithResults[0].toolResults[0];
  expect(firstResult.toolName).toBeTruthy();
  expect(firstResult.content).toBeTruthy();
});

test('parses conversation with custom title and plan mode', async () => {
  const result = await parseConversation(fixture('with-title-and-plan-mode.jsonl'));

  expect(result.metadata.customTitle).toBe('claude-sessions-fixtures-enable-plan-mode');
  expect(result.metadata.permissionMode).toBe('plan');
  expect(result.metadata.sessionId).toBe('1c54dea3-2a8d-42ff-aeda-6f18bf4f4443');
});

test('parses conversation with system messages', async () => {
  const result = await parseConversation(fixture('with-subagents-and-system.jsonl'));

  const systemMsgs = result.messages.filter((m) => m.role === 'system');
  expect(systemMsgs.length).toBeGreaterThan(0);

  // System messages should have subtype
  const localCmds = systemMsgs.filter((m) => m.subtype === 'local_command');
  expect(localCmds.length).toBeGreaterThan(0);
});

test('extracts metadata from first user record', async () => {
  const result = await parseConversation(fixture('with-tools.jsonl'));

  expect(result.metadata.cwd).toBeTruthy();
  expect(result.metadata.claudeVersion).toBeTruthy();
  expect(result.metadata.sourcePath).toContain('with-tools.jsonl');
});

test('derives project name from parent directory', async () => {
  const result = await parseConversation(fixture('basic.jsonl'));

  // The fixture lives in __tests__/fixtures/, so project name comes from that path
  // Not a real .claude/projects path, so it will derive from the actual parent dir
  expect(result.metadata.project).toBeTruthy();
});

test('parses thinking blocks from assistant messages', async () => {
  // Real fixtures have redacted (empty) thinking blocks, so use synthetic data
  const fakeJsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'explain monads' }, uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', sessionId: 's1' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'Let me think about how to explain monads simply...' },
      { type: 'text', text: 'A monad is a design pattern.' },
    ], id: 'msg1' }, uuid: 'a1', timestamp: '2026-01-01T00:00:01Z' }),
  ].join('\n');

  const result = await parseConversation('/fake/path.jsonl', {
    readFile: async () => fakeJsonl,
    hostname: () => 'test-host',
  });

  const asstMsgs = result.messages.filter((m) => m.role === 'assistant');
  expect(asstMsgs[0].thinking).toEqual(['Let me think about how to explain monads simply...']);
  expect(asstMsgs[0].text).toEqual(['A monad is a design pattern.']);
});

test('uses deps injection for readFile', async () => {
  const fakeJsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' }, uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', sessionId: 'test-session', cwd: '/test', version: '1.0', gitBranch: 'main' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }], id: 'msg1' }, uuid: 'a1', timestamp: '2026-01-01T00:00:01Z' }),
  ].join('\n');

  const mockReadFile = async () => fakeJsonl;
  const mockHostname = () => 'test-host';

  const result = await parseConversation('/fake/path/abc123.jsonl', {
    readFile: mockReadFile,
    hostname: mockHostname,
  });

  expect(result.metadata.sessionId).toBe('test-session');
  expect(result.metadata.hostname).toBe('test-host');
  expect(result.metadata.cwd).toBe('/test');
  expect(result.metadata.gitBranch).toBe('main');
  expect(result.messages.length).toBe(2);
  expect(result.messages[0].text[0]).toBe('hello');
  expect(result.messages[1].text[0]).toBe('hi there');
});

test('handles conversation with agent-color and mixed system subtypes', async () => {
  const result = await parseConversation(fixture('with-subagents-and-system.jsonl'));

  const systemMsgs = result.messages.filter((m) => m.role === 'system');
  const subtypes = systemMsgs.map((m) => m.subtype);

  // Should have various system subtypes
  expect(subtypes).toContain('local_command');
});

test('drops caveat/stdout noise and rewrites slash commands as one-liners', async () => {
  const result = await parseConversation(fixture('basic.jsonl'));

  const userMsgs = result.messages.filter((m) => m.role === 'user');
  for (const msg of userMsgs) {
    for (const text of msg.text) {
      expect(text).not.toMatch(/<local-command-caveat>/);
      expect(text).not.toMatch(/<local-command-stdout>/);
      expect(text).not.toMatch(/<command-name>/);
      expect(text).not.toMatch(/<command-args>/);
    }
  }

  // Real user message preserved
  expect(userMsgs[0].text[0]).toBe('tell me a joke');

  // /exit invocation rewritten as a compact one-liner
  const exitMsg = userMsgs.find((m) => m.text[0] === '/exit');
  expect(exitMsg).toBeTruthy();
});

test('rewrites skill-style command invocation (command-message first) with full args', () => {
  const raw = '<command-message>dsf-planning</command-message>\n<command-name>/dsf-planning</command-name>\n<command-args>lets plan an epic, build-info\nmilestones\n\nm1: investigate docs</command-args>';
  expect(transformUserText(raw)).toBe('/dsf-planning lets plan an epic, build-info\nmilestones\n\nm1: investigate docs');
});

test('truncates injected skill body to first two non-blank lines', async () => {
  const { truncateSkillBody } = await import('../lib/parse.js');
  const raw = 'Base directory for this skill: /home/theuser/.work-claude/skills/dsf-explore\n\n# Dark Factory Explore\n\nA structured conversation for investigative work. Not the full planning → session → debrief lifecycle.\n\n## When to Use\n\n- Cold starts\n- Research\n';
  expect(truncateSkillBody(raw)).toBe(
    'Base directory for this skill: /home/theuser/.work-claude/skills/dsf-explore\n# Dark Factory Explore',
  );
});

test('transformUserText no longer truncates skill bodies (done at format time)', () => {
  const raw = 'Base directory for this skill: /home/theuser/.work-claude/skills/dsf-explore\n\n# Dark Factory Explore\n\nbody';
  expect(transformUserText(raw)).toBe(raw);
});

test('empty-args slash command renders just the command name', () => {
  const raw = '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>';
  expect(transformUserText(raw)).toBe('/clear');
});

test('drops local command caveat and stdout noise', () => {
  expect(transformUserText('<local-command-caveat>some noise</local-command-caveat>')).toBeNull();
  expect(transformUserText('<local-command-stdout>output</local-command-stdout>')).toBeNull();
});

test('leaves ordinary user text unchanged', () => {
  expect(transformUserText('hello, here is my question')).toBe('hello, here is my question');
});

test('loads subagent conversations from subagent files', async () => {
  // The with-subagents-and-system fixture has a subagents/ directory
  const result = await parseConversation(fixture('with-subagents-and-system.jsonl'));

  const subagentMsgs = result.messages.filter((m) => m.role === 'subagent');
  expect(subagentMsgs.length).toBeGreaterThan(0);

  // Subagent messages should have agentPrompt and agentId
  expect(subagentMsgs[0].agentPrompt).toBeTruthy();
  expect(subagentMsgs[0].agentId).toBeTruthy();
});

test('loads subagent conversations via deps injection', async () => {
  const fakeJsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'find files' }, uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', sessionId: 's1' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tool1', name: 'Agent', input: { description: 'Find JS files', prompt: 'find all .js files' } },
    ], id: 'msg1' }, uuid: 'a1', timestamp: '2026-01-01T00:00:01Z' }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'Found 3 files' }] }, uuid: 'u2', timestamp: '2026-01-01T00:00:02Z' }),
  ].join('\n');

  const subagentJsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'find all .js files' }, uuid: 'su1' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Found index.js and utils.js' }] }, uuid: 'sa1' }),
  ].join('\n');

  const subagentMeta = JSON.stringify({ description: 'Find JS files', agentType: 'Explore' });

  const mockReadFile = async (path) => {
    if (path.endsWith('agent-abc.jsonl')) return subagentJsonl;
    if (path.endsWith('agent-abc.meta.json')) return subagentMeta;
    return fakeJsonl;
  };

  const mockReaddir = async (dir) => {
    if (dir.includes('subagents')) return ['agent-abc.jsonl', 'agent-abc.meta.json'];
    throw new Error('ENOENT');
  };

  const result = await parseConversation('/fake/path/session1.jsonl', {
    readFile: mockReadFile,
    readdir: mockReaddir,
    hostname: () => 'test-host',
  });

  const subagentMsgs = result.messages.filter((m) => m.role === 'subagent');
  expect(subagentMsgs.length).toBe(2);
  expect(subagentMsgs[0].agentPrompt).toBe('Find JS files');
  expect(subagentMsgs[1].text[0]).toBe('Found index.js and utils.js');
});

test('merges consecutive assistant messages', () => {
  const messages = [
    { role: 'user', text: ['hello'], toolCalls: [], toolResults: [], thinking: [] },
    { role: 'assistant', text: [], toolCalls: ['[Bash: ls]'], toolResults: [], thinking: [] },
    { role: 'user', text: [], toolCalls: [], toolResults: [{ toolName: 'Bash', content: 'file.txt' }], thinking: [] },
    { role: 'assistant', text: ['Here are the files'], toolCalls: [], toolResults: [], thinking: [] },
  ];

  const merged = mergeConsecutiveAssistant(messages);

  expect(merged.length).toBe(2); // user + one merged assistant
  expect(merged[1].role).toBe('assistant');
  expect(merged[1].toolCalls).toEqual(['[Bash: ls]']);
  expect(merged[1].toolResults).toEqual([{ toolName: 'Bash', content: 'file.txt' }]);
  expect(merged[1].text).toEqual(['Here are the files']);
});

test('merge preserves non-assistant messages', () => {
  const messages = [
    { role: 'user', text: ['q1'], toolCalls: [], toolResults: [], thinking: [] },
    { role: 'assistant', text: ['a1'], toolCalls: [], toolResults: [], thinking: [] },
    { role: 'user', text: ['q2'], toolCalls: [], toolResults: [], thinking: [] },
    { role: 'assistant', text: ['a2'], toolCalls: [], toolResults: [], thinking: [] },
  ];

  const merged = mergeConsecutiveAssistant(messages);

  expect(merged.length).toBe(4); // no merging — user messages between assistants
  expect(merged.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
});

test('merge absorbs tool-result-only user messages into assistant', () => {
  const messages = [
    { role: 'user', text: ['do it'], toolCalls: [], toolResults: [], thinking: [] },
    { role: 'assistant', text: [], toolCalls: ['[Read: foo]'], toolResults: [], thinking: [] },
    { role: 'user', text: [], toolCalls: [], toolResults: [{ toolName: 'Read', content: 'data' }], thinking: [] },
    { role: 'assistant', text: ['done'], toolCalls: [], toolResults: [], thinking: [] },
  ];

  const merged = mergeConsecutiveAssistant(messages);

  expect(merged.length).toBe(2);
  expect(merged[1].role).toBe('assistant');
  expect(merged[1].toolResults[0].content).toBe('data');
  expect(merged[1].text).toEqual(['done']);
});

test('extracts timestamps for startedAt and endedAt', async () => {
  const result = await parseConversation(fixture('basic.jsonl'));

  expect(result.metadata.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(result.metadata.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(new Date(result.metadata.endedAt) >= new Date(result.metadata.startedAt)).toBe(true);
});
