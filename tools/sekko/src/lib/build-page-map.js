import { readFileSync } from 'fs';
import { join } from 'path';

// Build a temporal history of (pageId, url, wallTime) tuples from
// trace.trace's frame-snapshot events. Used to resolve which pageId
// hosted a given URL at a given moment, for page-aware screenshot
// correlation.

export function buildPageHistory(traceContent) {
  if (!traceContent) return [];
  const entries = [];
  for (const line of traceContent.split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'frame-snapshot') continue;
    const snapshot = event.snapshot;
    if (!snapshot || !snapshot.isMainFrame) continue;
    const { pageId, frameUrl: url, wallTime } = snapshot;
    if (!pageId || !url || !wallTime) continue;
    if (url === 'about:blank') continue;
    entries.push({ pageId, url, wallTime });
  }
  entries.sort((a, b) => a.wallTime - b.wallTime);
  return entries;
}

export function buildPageHistoryFromTraceDir(traceDir, deps = {}) {
  const { readFileSync: readFn = readFileSync } = deps;
  let content;
  try {
    content = readFn(join(traceDir, 'trace.trace'), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return buildPageHistory(content);
}

// Find the pageId that was hosting `url` at or before `wallTime`.
// Returns null if no matching entry. Allows a small forward tolerance
// for clock skew between the in-page Date.now() used by user-events
// and the trace's wallTime stamps.
export function resolvePageId(history, url, wallTime, toleranceMs = 1500) {
  if (!url || wallTime == null || !history?.length) return null;
  let best = null;
  for (const entry of history) {
    if (entry.url !== url) continue;
    if (entry.wallTime > wallTime + toleranceMs) break;
    if (!best || entry.wallTime > best.wallTime) {
      best = entry;
    }
  }
  return best ? best.pageId : null;
}
