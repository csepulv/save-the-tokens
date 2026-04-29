import { test, expect } from 'vitest';
import { filterTurns } from '../lib/filter-turns.js';

function makeMessage(role, text, overrides = {}) {
  return {
    role,
    text: Array.isArray(text) ? text : [text],
    toolCalls: [],
    toolResults: [],
    thinking: [],
    timestamp: null,
    ...overrides,
  };
}

function makeConversation(messages) {
  return {
    metadata: { sessionId: 'test', customTitle: null },
    messages,
  };
}

// --- Pass-through (no flags) ---

test('no flags returns merged messages unchanged', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
  ]);

  const result = filterTurns(conv, {});

  expect(result.messages).toHaveLength(4);
  expect(result.messages[0].role).toBe('user');
  expect(result.messages[0].text).toEqual(['q1']);
});

test('preserves metadata', () => {
  const conv = makeConversation([makeMessage('user', 'q1')]);
  const result = filterTurns(conv, { skipTurns: 5 });
  expect(result.metadata).toBe(conv.metadata);
});

// --- mergeConsecutiveAssistant runs first ---

test('merges consecutive assistant messages before counting', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1a'),
    makeMessage('assistant', 'a1b'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
  ]);

  // After merge: u, a(merged), u, a → 4 turns, not 5.
  const result = filterTurns(conv, { limitTurns: 4 });
  expect(result.messages).toHaveLength(4);
  expect(result.messages[1].text).toEqual(['a1a', 'a1b']);
});

test('folds tool-result-only user records into preceding assistant before counting', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', [], { toolResults: [{ toolName: 'Bash', content: 'x' }] }),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
  ]);

  // After merge: u, a(with absorbed tool result), u, a → 4 turns
  const result = filterTurns(conv, {});
  expect(result.messages).toHaveLength(4);
  expect(result.messages[1].toolResults).toHaveLength(1);
});

// --- userOnly ---

test('userOnly drops assistant messages', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
  ]);

  const result = filterTurns(conv, { userOnly: true });

  expect(result.messages).toHaveLength(2);
  expect(result.messages.every((m) => m.role === 'user')).toBe(true);
  expect(result.messages[0].text).toEqual(['q1']);
  expect(result.messages[1].text).toEqual(['q2']);
});

test('userOnly drops system messages', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('system', 'system note'),
    makeMessage('assistant', 'a1'),
  ]);

  const result = filterTurns(conv, { userOnly: true });

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].role).toBe('user');
});

test('userOnly drops subagent messages', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('subagent', 'sub text', { agentId: 'sub-1', agentPrompt: 'do thing' }),
    makeMessage('user', 'q2'),
  ]);

  const result = filterTurns(conv, { userOnly: true });

  expect(result.messages).toHaveLength(2);
  expect(result.messages.every((m) => m.role === 'user')).toBe(true);
});

test('userOnly drops user records that are only tool results (no prose)', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    // Bare tool-result user record gets folded into assistant by merge,
    // but a tool-result user that survives merge (no preceding assistant)
    // should also be filtered out.
    makeMessage('user', [], { toolResults: [{ toolName: 'Bash', content: 'x' }] }),
  ]);

  const result = filterTurns(conv, { userOnly: true });

  // Only the user message with prose survives.
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].text).toEqual(['q1']);
});

test('userOnly strips toolResults from surviving user messages', () => {
  // A user message with both prose and tool results — userOnly strips the
  // results so --include-all cannot render them.
  const conv = makeConversation([
    makeMessage('user', 'q1', {
      toolResults: [{ toolName: 'Bash', content: 'output' }],
    }),
    makeMessage('assistant', 'a1'),
  ]);

  const result = filterTurns(conv, { userOnly: true });

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].toolResults).toEqual([]);
  expect(result.messages[0].text).toEqual(['q1']);
});

// --- skipTurns ---

test('skipTurns skips first N user/assistant turns', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
    makeMessage('assistant', 'a3'),
  ]);

  const result = filterTurns(conv, { skipTurns: 2 });

  // Skip first 2 turns (u q1, a a1) → start at u q2
  expect(result.messages).toHaveLength(4);
  expect(result.messages[0].text).toEqual(['q2']);
  expect(result.messages[1].text).toEqual(['a2']);
});

test('skipTurns of 0 is a no-op', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
  ]);

  const result = filterTurns(conv, { skipTurns: 0 });
  expect(result.messages).toHaveLength(2);
});

test('skipTurns past total turn count yields empty messages', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
  ]);

  const result = filterTurns(conv, { skipTurns: 5 });
  expect(result.messages).toEqual([]);
});

// --- limitTurns ---

test('limitTurns caps at N user/assistant turns', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
  ]);

  const result = filterTurns(conv, { limitTurns: 3 });

  expect(result.messages).toHaveLength(3);
  expect(result.messages[2].text).toEqual(['q2']);
});

test('limitTurns larger than total is a no-op', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
  ]);

  const result = filterTurns(conv, { limitTurns: 100 });
  expect(result.messages).toHaveLength(2);
});

// --- skipTurns + limitTurns combined ---

test('skip and limit combined select a window', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
    makeMessage('assistant', 'a3'),
    makeMessage('user', 'q4'),
  ]);

  // Skip 2, limit 3 → turns 3, 4, 5 → q2, a2, q3
  const result = filterTurns(conv, { skipTurns: 2, limitTurns: 3 });

  expect(result.messages).toHaveLength(3);
  expect(result.messages[0].text).toEqual(['q2']);
  expect(result.messages[1].text).toEqual(['a2']);
  expect(result.messages[2].text).toEqual(['q3']);
});

// --- system/subagent flow-through ---

test('system messages between selected turns flow through', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),       // turn 1
    makeMessage('assistant', 'a1'),  // turn 2
    makeMessage('system', 'sys'),    // not a turn — between
    makeMessage('user', 'q2'),       // turn 3
    makeMessage('assistant', 'a2'),  // turn 4
  ]);

  const result = filterTurns(conv, { skipTurns: 1, limitTurns: 3 });

  // Window: turns 2..4 (a1, q2, a2). System at index 2 is between turn 2
  // and turn 3 → included.
  expect(result.messages).toHaveLength(4);
  expect(result.messages[0].role).toBe('assistant');
  expect(result.messages[1].role).toBe('system');
  expect(result.messages[2].role).toBe('user');
  expect(result.messages[3].role).toBe('assistant');
});

test('system messages before first kept turn are dropped', () => {
  const conv = makeConversation([
    makeMessage('system', 'sys-prelude'),
    makeMessage('user', 'q1'),       // turn 1
    makeMessage('assistant', 'a1'),  // turn 2
  ]);

  const result = filterTurns(conv, { skipTurns: 1 });

  // Skip turn 1 → start at turn 2 (assistant a1). Leading system dropped.
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].role).toBe('assistant');
});

test('system messages after last kept turn are dropped', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),       // turn 1
    makeMessage('assistant', 'a1'),  // turn 2
    makeMessage('system', 'sys-trail'),
  ]);

  const result = filterTurns(conv, { limitTurns: 2 });

  expect(result.messages).toHaveLength(2);
  expect(result.messages.every((m) => m.role !== 'system')).toBe(true);
});

test('subagent messages flow through within window', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),       // turn 1
    makeMessage('assistant', 'a1'),  // turn 2
    makeMessage('subagent', 'sub', { agentId: 's1', agentPrompt: 'p' }),
    makeMessage('user', 'q2'),       // turn 3
  ]);

  const result = filterTurns(conv, { skipTurns: 1 });

  expect(result.messages).toHaveLength(3);
  expect(result.messages[1].role).toBe('subagent');
});

// --- combined: userOnly + skip/limit ---

test('userOnly with skipTurns counts user messages only', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
  ]);

  // After userOnly: [q1, q2, q3]. Skip 1 → [q2, q3].
  const result = filterTurns(conv, { userOnly: true, skipTurns: 1 });

  expect(result.messages).toHaveLength(2);
  expect(result.messages[0].text).toEqual(['q2']);
  expect(result.messages[1].text).toEqual(['q3']);
});

test('userOnly with limitTurns caps user messages', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
  ]);

  const result = filterTurns(conv, { userOnly: true, limitTurns: 2 });

  expect(result.messages).toHaveLength(2);
  expect(result.messages[0].text).toEqual(['q1']);
  expect(result.messages[1].text).toEqual(['q2']);
});

test('userOnly + skip + limit window over user prose', () => {
  const conv = makeConversation([
    makeMessage('user', 'q1'),
    makeMessage('assistant', 'a1'),
    makeMessage('user', 'q2'),
    makeMessage('assistant', 'a2'),
    makeMessage('user', 'q3'),
    makeMessage('assistant', 'a3'),
    makeMessage('user', 'q4'),
  ]);

  const result = filterTurns(conv, { userOnly: true, skipTurns: 1, limitTurns: 2 });

  expect(result.messages).toHaveLength(2);
  expect(result.messages[0].text).toEqual(['q2']);
  expect(result.messages[1].text).toEqual(['q3']);
});

// --- validation ---

test('throws on negative skipTurns', () => {
  const conv = makeConversation([makeMessage('user', 'q1')]);
  expect(() => filterTurns(conv, { skipTurns: -1 })).toThrow(/skipTurns/);
});

test('throws on zero or negative limitTurns', () => {
  const conv = makeConversation([makeMessage('user', 'q1')]);
  expect(() => filterTurns(conv, { limitTurns: 0 })).toThrow(/limitTurns/);
  expect(() => filterTurns(conv, { limitTurns: -3 })).toThrow(/limitTurns/);
});

test('non-integer values rejected', () => {
  const conv = makeConversation([makeMessage('user', 'q1')]);
  expect(() => filterTurns(conv, { skipTurns: 1.5 })).toThrow(/skipTurns/);
  expect(() => filterTurns(conv, { limitTurns: 2.7 })).toThrow(/limitTurns/);
});
