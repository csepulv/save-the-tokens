import { join, basename } from 'node:path';
import { loadConfig, expandTilde, resolveSource } from '../config.js';
import { parseDateArg } from '../date.js';
import { listJsonlFiles, extractEncodedProjectDir } from '../discover.js';
import { resolveProjectFullPath } from '../project-name.js';
import {
  aggregateSession,
  readJsonlRecords,
  readSubagentRecords,
  sessionIdFromPath,
} from '../stats.js';

/**
 * Aggregate per-session stats as JSON.
 *
 * args: { after, before, source?, format, config? }
 *
 * Prints a single JSON object to stdout. Exits with:
 *   0 — at least one session emitted
 *   2 — no sessions in window (still valid JSON with sessions: [])
 */
export async function run(args) {
  if (args.format !== 'json') {
    console.error(`Error: --format must be 'json' (got: ${args.format})`);
    process.exit(1);
  }

  let after, before;
  try {
    after = parseDateArg(args.after, { endOfDay: false });
    before = parseDateArg(args.before, { endOfDay: true });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const configDeps = args.config ? { configPath: expandTilde(args.config) } : {};
  const config = await loadConfig(configDeps);
  const sources = resolveSources(args.source, config);

  const sessions = [];
  for (const { alias, path } of sources) {
    const projectsDir = join(path, 'projects');
    const jsonlPaths = await listJsonlFiles(projectsDir);
    for (const jsonlPath of jsonlPaths) {
      const records = await readJsonlRecords(jsonlPath);
      const subagentRecords = await readSubagentRecords(jsonlPath);
      const agg = aggregateSession(records, subagentRecords, { after, before });
      if (!agg) continue;

      const encodedDir = extractEncodedProjectDir(jsonlPath);
      const projectPath = encodedDir ? await resolveProjectFullPath(encodedDir) : '';
      sessions.push({
        session_id: sessionIdFromPath(jsonlPath),
        source: alias,
        project: projectPath ? basename(projectPath) : '',
        project_path: projectPath,
        ...agg,
      });
    }
  }

  const output = {
    version: '1',
    generated_at: new Date().toISOString(),
    window: { after: args.after, before: args.before },
    sources: sources.map(({ alias, path }) => ({ alias, path })),
    sessions,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(sessions.length === 0 ? 2 : 0);
}

function resolveSources(sourceArg, config) {
  if (!sourceArg) {
    return Object.entries(config.sources).map(([alias, path]) => ({ alias, path }));
  }

  const looksLikePath = sourceArg.includes('/') || sourceArg.startsWith('~');
  if (looksLikePath) {
    return [{ alias: '__adhoc__', path: resolveSource(sourceArg, config) }];
  }

  const path = config.sources[sourceArg];
  if (!path) {
    console.error(`Error: unknown source alias '${sourceArg}'. Configured: ${Object.keys(config.sources).join(', ')}`);
    process.exit(1);
  }
  return [{ alias: sourceArg, path }];
}
