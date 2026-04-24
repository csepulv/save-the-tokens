import { test, expect } from 'vitest';
import {
  normalizeRecord,
  aggregateSession,
  readJsonlRecords,
  readSubagentRecords,
  sessionIdFromPath,
} from '../lib/stats.js';

const WINDOW = {
  after: new Date('2026-04-13T00:00:00-07:00'),
  before: new Date('2026-04-19T23:59:59.999-07:00'),
};

const inWindowTs = '2026-04-15T12:00:00.000Z';

// Helpers for building hand-authored records. Keeps tests scannable.
const userRec = (text, ts = inWindowTs) => ({
  type: 'user', timestamp: ts, message: { content: text },
});
const assistantRec = (usage, ts = inWindowTs, model = 'claude-opus-4-7') => ({
  type: 'assistant', timestamp: ts, message: { model, usage },
});
const progressSubagent = (usage, ts = inWindowTs, model = 'claude-haiku-4-5') => ({
  type: 'progress', timestamp: ts,
  data: { type: 'agent_progress',
    message: { message: { role: 'assistant', model, usage } } },
});
const usage = ({ input = 0, output = 0, cacheRead = 0, cacheCreation = 0 } = {}) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
});

// --- normalizeRecord ---

test('normalizes top-level user with text', () => {
  const n = normalizeRecord(userRec('hello world'));
  expect(n).toEqual({ role: 'user', timestamp: inWindowTs, usage: null, model: null });
});

test('drops user with <local-command-stdout> only', () => {
  const n = normalizeRecord(userRec('<local-command-stdout>blah</local-command-stdout>'));
  expect(n).toBeNull();
});

test('drops user with only tool_result blocks', () => {
  const rec = {
    type: 'user', timestamp: inWindowTs,
    message: { content: [{ type: 'tool_result', content: 'x' }] },
  };
  expect(normalizeRecord(rec)).toBeNull();
});

test('counts slash-command user as a turn', () => {
  const rec = userRec('<command-name>/michi-explore</command-name><command-args>foo</command-args>');
  const n = normalizeRecord(rec);
  expect(n.role).toBe('user');
});

test('normalizes top-level assistant with usage', () => {
  const n = normalizeRecord(assistantRec(usage({ input: 10, output: 5 })));
  expect(n.role).toBe('assistant');
  expect(n.usage.input_tokens).toBe(10);
  expect(n.model).toBe('claude-opus-4-7');
});

test('normalizes inline agent_progress as subagent', () => {
  const n = normalizeRecord(progressSubagent(usage({ input: 3, output: 1 })));
  expect(n.role).toBe('subagent');
  expect(n.usage.input_tokens).toBe(3);
  expect(n.model).toBe('claude-haiku-4-5');
});

test('ignores inline agent_progress whose inner role is user', () => {
  const rec = {
    type: 'progress', timestamp: inWindowTs,
    data: { type: 'agent_progress', message: { message: { role: 'user', content: 'x' } } },
  };
  expect(normalizeRecord(rec)).toBeNull();
});

test('in-subagent-file mode: assistant counts as subagent', () => {
  const n = normalizeRecord(assistantRec(usage({ input: 2 })), { inSubagentFile: true });
  expect(n.role).toBe('subagent');
  expect(n.usage.input_tokens).toBe(2);
});

test('in-subagent-file mode: user is ignored (only assistants count)', () => {
  const n = normalizeRecord(userRec('hi'), { inSubagentFile: true });
  expect(n).toBeNull();
});

test('ignores skipped types (permission-mode, file-history-snapshot, etc)', () => {
  for (const type of ['permission-mode', 'file-history-snapshot', 'last-prompt',
                      'attachment', 'system', 'custom-title', 'agent-name']) {
    expect(normalizeRecord({ type, timestamp: inWindowTs })).toBeNull();
  }
});

// --- aggregateSession ---

// t1 — happy path
test('t1: counts user/assistant turns and sums tokens', () => {
  const records = [
    userRec('hello'),
    assistantRec(usage({ input: 10, output: 5, cacheRead: 100, cacheCreation: 50 })),
    userRec('more'),
    assistantRec(usage({ input: 20, output: 8 })),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns).toEqual({ user: 2, assistant: 2, subagent: 0 });
  expect(result.tokens_by_model['claude-opus-4-7']).toEqual({
    input: 30, output: 13, cache_read: 100, cache_creation: 50,
  });
});

// t2 — empty
test('t2: returns null when no records', () => {
  expect(aggregateSession([], [], WINDOW)).toBeNull();
});

test('t2b: returns null when all records are out of window', () => {
  const records = [assistantRec(usage({ input: 1 }), '2026-04-01T00:00:00.000Z')];
  expect(aggregateSession(records, [], WINDOW)).toBeNull();
});

// t3 — tool-result-only user excluded
test('t3: tool-result-only user messages excluded from user turn count', () => {
  const records = [
    userRec('real user text'),
    { type: 'user', timestamp: inWindowTs, message: {
      content: [{ type: 'tool_result', content: 'bla' }] } },
    assistantRec(usage({ input: 1, output: 1 })),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.user).toBe(1);
});

// t4 — slash command user counted
test('t4: slash-command user message counted as user turn', () => {
  const records = [
    userRec('<command-name>/loop</command-name><command-args></command-args>'),
    assistantRec(usage({ input: 1 })),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.user).toBe(1);
});

// t5 — window filter
test('t5: records outside window excluded from turns and tokens', () => {
  const records = [
    assistantRec(usage({ input: 100 }), '2026-04-01T00:00:00.000Z'),     // before
    assistantRec(usage({ input: 10 }), inWindowTs),                       // in
    assistantRec(usage({ input: 50 }), '2026-05-01T00:00:00.000Z'),       // after
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.assistant).toBe(1);
  expect(result.tokens_by_model['claude-opus-4-7'].input).toBe(10);
});

// t6 — assistant without usage
test('t6: assistant with no usage counts as turn but contributes 0 tokens', () => {
  const records = [
    { type: 'assistant', timestamp: inWindowTs, message: { model: 'claude-opus-4-7' } },
    assistantRec(usage({ input: 5 })),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.assistant).toBe(2);
  expect(result.tokens_by_model['claude-opus-4-7'].input).toBe(5);
});

// t7 — multi-model
test('t7: multi-model session keys tokens correctly', () => {
  const records = [
    assistantRec(usage({ input: 10 }), inWindowTs, 'claude-opus-4-7'),
    assistantRec(usage({ input: 20 }), inWindowTs, 'claude-haiku-4-5'),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.tokens_by_model['claude-opus-4-7'].input).toBe(10);
  expect(result.tokens_by_model['claude-haiku-4-5'].input).toBe(20);
});

test('t7b: assistant without model keys as "unknown"', () => {
  const records = [
    { type: 'assistant', timestamp: inWindowTs,
      message: { usage: usage({ input: 7 }) } },
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.tokens_by_model['unknown'].input).toBe(7);
});

// t8 — subagent both formats roll in
test('t8: inline agent_progress subagent rolls into turns and tokens', () => {
  const records = [
    userRec('run subagent'),
    assistantRec(usage({ input: 5 })),
    progressSubagent(usage({ input: 3, output: 1 }), inWindowTs, 'claude-haiku-4-5'),
    progressSubagent(usage({ input: 2 }), inWindowTs, 'claude-haiku-4-5'),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.subagent).toBe(2);
  expect(result.tokens_by_model['claude-haiku-4-5'].input).toBe(5);
});

test('t8b: file-based subagent assistant rolls into turns and tokens', () => {
  const records = [userRec('go'), assistantRec(usage({ input: 5 }))];
  const subagentRecords = [
    assistantRec(usage({ input: 4, output: 2 }), inWindowTs, 'claude-haiku-4-5'),
    userRec('inner reply', inWindowTs),   // ignored in subagent-file mode
    assistantRec(usage({ input: 6 }), inWindowTs, 'claude-haiku-4-5'),
  ];
  const result = aggregateSession(records, subagentRecords, WINDOW);
  expect(result.turns.subagent).toBe(2);
  expect(result.tokens_by_model['claude-haiku-4-5'].input).toBe(10);
});

// t9 — missing cache fields default to 0
test('t9: missing cache fields default to 0', () => {
  const records = [
    { type: 'assistant', timestamp: inWindowTs,
      message: { model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 2 } } },
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.tokens_by_model['claude-opus-4-7']).toEqual({
    input: 5, output: 2, cache_read: 0, cache_creation: 0,
  });
});

// t10 — started_at / ended_at are in-window boundaries
test('t10: started_at/ended_at reflect first/last in-window timestamps', () => {
  const records = [
    assistantRec(usage({ input: 1 }), '2026-04-01T00:00:00.000Z'),     // out
    assistantRec(usage({ input: 1 }), '2026-04-15T08:00:00.000Z'),     // first in-window
    assistantRec(usage({ input: 1 }), '2026-04-15T10:30:00.000Z'),     // last in-window
    assistantRec(usage({ input: 1 }), '2026-05-01T00:00:00.000Z'),     // out
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.started_at).toBe('2026-04-15T08:00:00.000Z');
  expect(result.ended_at).toBe('2026-04-15T10:30:00.000Z');
  expect(result.duration_ms).toBe(2.5 * 60 * 60 * 1000);
});

// t11 — inline agent_progress tokens at nested path
test('t11: inline agent_progress tokens extracted from data.message.message.usage', () => {
  const records = [progressSubagent(
    { input_tokens: 42, output_tokens: 7, cache_creation_input_tokens: 100 },
    inWindowTs, 'claude-haiku-4-5',
  )];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.tokens_by_model['claude-haiku-4-5']).toEqual({
    input: 42, output: 7, cache_read: 0, cache_creation: 100,
  });
});

// t12 — mixed inline + file-based subagents roll into same buckets
test('t12: mixed inline + file-based subagents share turns.subagent and tokens', () => {
  const records = [
    assistantRec(usage({ input: 1 })),
    progressSubagent(usage({ input: 10 }), inWindowTs, 'claude-haiku-4-5'),
  ];
  const subagentRecords = [
    assistantRec(usage({ input: 20 }), inWindowTs, 'claude-haiku-4-5'),
  ];
  const result = aggregateSession(records, subagentRecords, WINDOW);
  expect(result.turns.subagent).toBe(2);
  expect(result.tokens_by_model['claude-haiku-4-5'].input).toBe(30);
});

// extra — records with no timestamp skipped
test('records without timestamp are skipped', () => {
  const records = [
    { type: 'assistant', message: { model: 'x', usage: usage({ input: 5 }) } }, // no ts
    assistantRec(usage({ input: 1 })),
  ];
  const result = aggregateSession(records, [], WINDOW);
  expect(result.turns.assistant).toBe(1);
  expect(result.tokens_by_model['claude-opus-4-7'].input).toBe(1);
});

// --- readJsonlRecords (deps-injected I/O) ---

test('readJsonlRecords parses each non-blank line', async () => {
  const mockRead = async () => `{"type":"user","x":1}\n\n{"type":"assistant","x":2}\n`;
  const records = await readJsonlRecords('/fake.jsonl', { readFile: mockRead });
  expect(records).toEqual([
    { type: 'user', x: 1 },
    { type: 'assistant', x: 2 },
  ]);
});

// --- readSubagentRecords ---

test('readSubagentRecords returns [] when subagents dir missing', async () => {
  const mockReadDir = async () => { const e = new Error('no'); e.code = 'ENOENT'; throw e; };
  const result = await readSubagentRecords('/fake.jsonl', { readdir: mockReadDir });
  expect(result).toEqual([]);
});

test('readSubagentRecords concatenates records from all .jsonl files', async () => {
  const mockReadDir = async () => ['agent-a.jsonl', 'agent-a.meta.json', 'agent-b.jsonl'];
  const mockRead = async (path) => {
    if (path.endsWith('agent-a.jsonl')) return '{"type":"assistant","from":"a"}\n';
    if (path.endsWith('agent-b.jsonl')) return '{"type":"assistant","from":"b"}\n';
    throw new Error(`unexpected read: ${path}`);
  };
  const result = await readSubagentRecords('/p/sess.jsonl',
    { readdir: mockReadDir, readFile: mockRead });
  expect(result).toEqual([
    { type: 'assistant', from: 'a' },
    { type: 'assistant', from: 'b' },
  ]);
});

// --- sessionIdFromPath ---

test('sessionIdFromPath strips .jsonl and dir', () => {
  expect(sessionIdFromPath('/a/b/c/03ce753b-f800-493d-91fe-b6a63c6875d7.jsonl'))
    .toBe('03ce753b-f800-493d-91fe-b6a63c6875d7');
});
