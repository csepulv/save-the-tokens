import { listConversations } from '../discover.js';
import { loadConfig, resolveSource } from '../config.js';
import { collectAllEntries } from '../source-entries.js';

/**
 * List conversations.
 *
 * args: { source?, filter? }
 *   - source absent → list from all configured sources (newest first)
 *   - source given  → list from just that source
 */
export async function run(args) {
  const config = await loadConfig();

  if (args.source) {
    const sourceDir = resolveSource(args.source, config);
    const entries = await listConversations(sourceDir);
    printListTable(filterEntries(entries, args.filter));
    return;
  }

  const allEntries = await collectAllEntries(config);
  allEntries.sort((a, b) => b.date - a.date);
  printListTable(filterEntries(allEntries, args.filter), { showSource: true });
}

function filterEntries(entries, filter) {
  if (!filter) return entries;
  const lower = filter.toLowerCase();
  return entries.filter((e) =>
    e.project.toLowerCase().includes(lower)
    || (e.encodedDir ?? '').toLowerCase().includes(lower)
  );
}

function printListTable(entries, { showSource = false } = {}) {
  if (entries.length === 0) {
    console.error('No conversations found.');
    return;
  }

  const srcCol = showSource ? 12 : 0;
  const header = showSource
    ? `${'Source'.padEnd(srcCol)} ${'ID'.padEnd(38)} ${'Date'.padEnd(18)} ${'Project'.padEnd(25)} Title / First message`
    : `${'ID'.padEnd(38)} ${'Date'.padEnd(18)} ${'Project'.padEnd(25)} Title / First message`;

  console.log(header);
  console.log('-'.repeat(120 + srcCol));

  for (const entry of entries) {
    const dateStr = entry.date.toISOString().slice(0, 16).replace('T', ' ');
    const project = entry.project.length > 25
      ? entry.project.slice(0, 23) + '..'
      : entry.project;
    const row = showSource
      ? `${(entry.sourceName ?? '').padEnd(srcCol)} ${entry.sessionId.padEnd(38)} ${dateStr.padEnd(18)} ${project.padEnd(25)} ${entry.preview}`
      : `${entry.sessionId.padEnd(38)} ${dateStr.padEnd(18)} ${project.padEnd(25)} ${entry.preview}`;
    console.log(row);
  }
}
