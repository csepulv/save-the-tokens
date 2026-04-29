import { mergeConsecutiveAssistant } from './parse.js';

/**
 * Filter a parsed conversation by turn-based options.
 *
 * Turn semantics: a "turn" is a single user OR assistant message in the
 * post-merge messages array. System and subagent messages do not count
 * toward the turn count. They flow through transparently when they fall
 * between selected turns; they are dropped if they fall before the first
 * kept turn or after the last.
 *
 * Options:
 *   - userOnly: keep only user messages with prose; strip toolResults so
 *     --include-all cannot smuggle them back in. Drops assistant, system,
 *     subagent, and tool-result-only user records.
 *   - skipTurns: skip the first N user/assistant turns. Default 0.
 *   - limitTurns: keep at most N user/assistant turns. Default unlimited.
 *
 * Returns a new conversation object with the same metadata reference and
 * a filtered messages array. Pure: no I/O, no mutation of input.
 */
export function filterTurns(conversation, options = {}) {
  const { userOnly = false, skipTurns = 0, limitTurns } = options;

  validateOptions(skipTurns, limitTurns);

  let messages = mergeConsecutiveAssistant(conversation.messages);

  if (userOnly) messages = applyUserOnly(messages);
  if (skipTurns > 0 || limitTurns !== undefined) {
    messages = applyWindow(messages, skipTurns, limitTurns);
  }

  return { ...conversation, messages };
}

function validateOptions(skipTurns, limitTurns) {
  if (!Number.isInteger(skipTurns) || skipTurns < 0) {
    throw new Error(`Invalid skipTurns: ${skipTurns}. Must be a non-negative integer.`);
  }
  if (limitTurns !== undefined && (!Number.isInteger(limitTurns) || limitTurns < 1)) {
    throw new Error(`Invalid limitTurns: ${limitTurns}. Must be a positive integer.`);
  }
}

function applyUserOnly(messages) {
  return messages
    .filter((m) => m.role === 'user' && m.text.length > 0)
    .map((m) => ({ ...m, toolResults: [] }));
}

// Walk the merged messages, counting only user/assistant turns. Slice from
// the first kept turn through the last kept turn (inclusive).
// System/subagent messages between are preserved; before-first or
// after-last are dropped.
function applyWindow(messages, skipTurns, limitTurns) {
  let turnCount = 0;
  let startIdx = -1;
  let lastTurnIdx = -1;

  const lastKeptTurn = limitTurns !== undefined
    ? skipTurns + limitTurns
    : Infinity;

  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role;
    if (role !== 'user' && role !== 'assistant') continue;

    turnCount++;
    if (turnCount <= skipTurns) continue;
    if (turnCount > lastKeptTurn) break;

    if (startIdx === -1) startIdx = i;
    lastTurnIdx = i;
  }

  if (startIdx === -1) return [];
  return messages.slice(startIdx, lastTurnIdx + 1);
}
