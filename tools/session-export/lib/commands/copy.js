import { existsSync } from 'node:fs';
import {
  collectScopeFiles,
  buildCopyEntries,
  copySessionFile,
} from '../session-files.js';
import { loadConfig as defaultLoadConfig, resolveSource } from '../config.js';

/**
 * Copy session JSONL files from one Claude folder to another.
 *
 * args: { id?, project?, source, dest }
 *   - exactly one of <id> (positional) | --project is required
 *   - source is required; dest defaults to "default"
 *   - id positional is exact: full UUID or exact custom-title slug
 *
 * Unconditional copy: an existing dest file is overwritten (cp semantics
 * — conflict-aware sync is `merge`'s job). Source mtime is preserved so
 * the copy keeps the session's place in `list` / `stats`.
 */
export async function run(args, deps = {}) {
  const { loadConfig = defaultLoadConfig } = deps;

  if (!validateScope(args)) process.exit(1);

  const config = await loadConfig();
  const sourceDir = resolveSource(args.source, config);
  const destDir = resolveSource(args.dest, config);

  if (sourceDir === destDir) {
    console.error('Error: --source and --dest resolve to the same directory.');
    process.exit(1);
  }
  if (!existsSync(sourceDir)) {
    console.error(`Error: source directory does not exist: ${sourceDir}`);
    process.exit(1);
  }

  const sourceFiles = await collectScopeFiles(args, sourceDir);
  if (sourceFiles.length === 0) {
    console.error(`Error: no sessions matched ${describeScope(args)} in source.`);
    process.exit(1);
  }

  const entries = await buildCopyEntries(sourceFiles, sourceDir, destDir);
  for (const entry of entries) {
    await copySessionFile(entry);
  }

  console.log(`Copied ${entries.length} session(s) to ${destDir}.`);
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
