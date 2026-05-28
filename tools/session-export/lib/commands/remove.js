import { unlink } from 'node:fs/promises';
import { extractEncodedProjectDir } from '../discover.js';
import { resolveProjectName } from '../project-name.js';
import {
  resolveIdScope,
  resolveProjectScope,
  cleanupEmptyDirs,
} from '../session-files.js';
import { loadConfig as defaultLoadConfig, resolveSource } from '../config.js';

/**
 * Delete Claude Code session JSONL files (and clean up empty project dirs).
 *
 * args: { id?, project?, source?, yes? }
 *   - exactly one of <id> (positional) | --project is required
 *   - source absent → walk every configured source
 *   - source given  → just that one (alias or path)
 *   - yes absent    → dry-run: print what would be deleted, change nothing
 *   - yes set       → unlink files; remove encoded project dir if empty
 *
 * <id> is exact: full UUID filename or exact custom-title slug. Substring
 * matches are rejected — destructive ops shouldn't silently broaden scope.
 *
 * --project is exact display-name match unless it contains '*', in which
 * case '*' is the only glob metacharacter (other regex specials are literal).
 */
export async function run(args, deps = {}) {
  const { loadConfig = defaultLoadConfig } = deps;

  if (!validateScope(args)) process.exit(1);

  const config = await loadConfig();

  const sources = args.source
    ? [{ name: args.source, dir: resolveSource(args.source, config) }]
    : Object.entries(config.sources).map(([name, dir]) => ({ name, dir }));

  const candidates = await collectCandidates(args, sources);

  if (candidates.length === 0) {
    console.error(`Error: no sessions matched ${describeScope(args)}.`);
    process.exit(1);
  }

  if (args.id && candidates.length > 1) {
    console.error(`Error: '${args.id}' matches ${candidates.length} sessions across sources. Disambiguate with --source.`);
    for (const c of candidates) {
      console.error(`${c.sourceName}\t${c.sessionId}\t${c.project}`);
    }
    process.exit(1);
  }

  for (const c of candidates) {
    console.log(`${c.sourceName}\t${c.sessionId}\t${c.project}\t${c.path}`);
  }

  if (!args.yes) {
    const projectKeys = new Set(candidates.map((c) => `${c.sourceName}|${c.project}`));
    console.error(`\nWould delete ${candidates.length} session(s) across ${projectKeys.size} project(s). Re-run with --yes to execute.`);
    return;
  }

  let deleted = 0;
  for (const c of candidates) {
    await unlink(c.path);
    deleted++;
  }

  const cleanedDirs = await cleanupEmptyDirs(candidates);
  console.error(`\nDeleted ${deleted} session(s); cleaned up ${cleanedDirs} empty project dir(s).`);
}

function validateScope(args) {
  const scopes = [args.id, args.project].filter(Boolean);
  if (scopes.length === 1) return true;
  console.error('Error: pass exactly one of <id> (positional slug/uuid) or --project.');
  return false;
}

function describeScope(args) {
  if (args.id) return `id '${args.id}'`;
  if (args.project) return `project '${args.project}'`;
  return 'scope';
}

async function collectCandidates(args, sources) {
  const all = [];
  for (const { name, dir } of sources) {
    const paths = args.id
      ? await resolveIdScope(args.id, dir)
      : await resolveProjectScope(args.project, dir);
    for (const p of paths) {
      const sessionId = p.split('/').pop().replace('.jsonl', '');
      const encoded = extractEncodedProjectDir(p);
      const project = encoded ? await resolveProjectName(encoded) : '';
      all.push({ sourceName: name, sourceDir: dir, sessionId, encoded, project, path: p });
    }
  }
  return all;
}
