import { listConversations } from '../discover.js';
import { loadConfig, resolveSource } from '../config.js';
import { collectAllEntries } from '../source-entries.js';
import { filterByDate } from '../export-all.js';
import { parseDateArg } from '../date.js';

/**
 * List conversations.
 *
 * args: { source?, filter?, after?, before?, format? }
 *   - source absent → list from all configured sources (newest first)
 *   - source given  → list from just that source
 *   - after/before  → restrict by mtime (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
 *   - format 'json' → machine-readable array with full ISO timestamps
 */
export async function run(args) {
  const config = await loadConfig();

  let afterDate = null;
  let beforeDate = null;
  try {
    if (args.after) afterDate = parseDateArg(args.after, { endOfDay: false });
    if (args.before) beforeDate = parseDateArg(args.before, { endOfDay: true });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let entries;
  let showSource;
  if (args.source) {
    const sourceDir = resolveSource(args.source, config);
    entries = await listConversations(sourceDir);
    showSource = false;
  } else {
    entries = await collectAllEntries(config);
    entries.sort((a, b) => b.date - a.date);
    showSource = true;
  }
  entries = filterByDate(filterEntries(entries, args.filter), afterDate, beforeDate);

  if (args.format === 'json') {
    console.log(JSON.stringify(entriesToJson(entries, { showSource }), null, 2));
    return;
  }
  printListTable(entries, { showSource });
}

function filterEntries(entries, filter) {
  if (!filter) return entries;
  const lower = filter.toLowerCase();
  return entries.filter((e) =>
    e.project.toLowerCase().includes(lower)
    || (e.encodedDir ?? '').toLowerCase().includes(lower)
  );
}

// Machine-readable list — full ISO `date` (mtime), no minute truncation or
// column-width clipping. Consumers (e.g. the junkdrawer CLI's needs-sync)
// parse this instead of scraping the table.
export function entriesToJson(entries, { showSource = false } = {}) {
  return entries.map((entry) => ({
    ...(showSource ? { source: entry.sourceName ?? null } : {}),
    sessionId: entry.sessionId,
    date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
    project: entry.project,
    encodedDir: entry.encodedDir ?? null,
    preview: entry.preview,
  }));
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
