import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Parse trace.trace NDJSON and return paired action entries.
 * Each action has a before (with method, class, params, selector)
 * and an after (with endTime, result).
 */
export function parseActions(traceDir) {
  const tracePath = join(traceDir, 'trace.trace');
  const content = readFileSync(tracePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));

  return pairActions(events);
}

export function pairActions(events) {
  const befores = new Map();
  const actions = [];

  for (const event of events) {
    if (event.type === 'before') {
      befores.set(event.callId, event);
    }

    if (event.type === 'after' && befores.has(event.callId)) {
      const before = befores.get(event.callId);
      actions.push({
        callId: event.callId,
        class: before.class,
        method: before.method,
        params: before.params || {},
        startTime: before.startTime,
        endTime: event.endTime,
        selector: before.params?.selector || null,
      });
    }
  }

  return actions;
}

/**
 * Extract unique selectors from action entries.
 */
export function extractSelectors(actions) {
  const selectors = new Set();
  for (const action of actions) {
    if (action.selector) {
      selectors.add(action.selector);
    }
  }
  return [...selectors];
}
