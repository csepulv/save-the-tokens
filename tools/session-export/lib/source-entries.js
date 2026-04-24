import { listConversations } from './discover.js';

/**
 * Walk every source directory declared in config.sources and return all
 * conversations tagged with their source name.
 *
 * Preserves source-iteration order (no sorting by date). Caller can sort
 * or filter downstream.
 */
export async function collectAllEntries(config, deps = {}) {
  const allEntries = [];
  for (const [sourceName, sourceDir] of Object.entries(config.sources)) {
    const entries = await listConversations(sourceDir, deps);
    for (const entry of entries) {
      entry.sourceName = sourceName;
    }
    allEntries.push(...entries);
  }
  return allEntries;
}
