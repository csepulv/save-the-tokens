import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { extractEncodedProjectDir } from '../discover.js';
import {
  collectScopeFiles,
  buildCopyEntries,
  copySessionFile,
  cleanupEmptyDirs,
} from '../session-files.js';
import { loadConfig as defaultLoadConfig, resolveSource } from '../config.js';

/**
 * Move session JSONL files from one Claude folder to another — copy to
 * dest, then delete from source.
 *
 * args: { id?, project?, source, dest, yes? }
 *   - exactly one of <id> (positional) | --project is required
 *   - source is required; dest defaults to "default"
 *   - yes absent → dry-run: print what would move, change nothing
 *   - yes set    → copy every file, then delete sources, then clean up
 *                  encoded project dirs left empty in the source
 *
 * Copy overwrites dest unconditionally (cp semantics); source mtime is
 * preserved. Copy-all precedes delete-all so a mid-copy failure leaves
 * the source intact and the operation re-runnable.
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
    const marker = existsSync(entry.destPath) ? '\t(overwrites existing in dest)' : '';
    console.log(`${entry.relPath}${marker}`);
  }

  if (!args.yes) {
    console.error(`\nWould move ${entries.length} session(s) to ${destDir}. Re-run with --yes to execute.`);
    return;
  }

  // Copy everything first, then delete. A failure mid-copy leaves the
  // source untouched and the move re-runnable.
  for (const entry of entries) {
    await copySessionFile(entry);
  }
  for (const entry of entries) {
    await unlink(entry.sourcePath);
  }

  const candidates = entries.map((entry) => ({
    sourceDir,
    encoded: extractEncodedProjectDir(entry.sourcePath),
  }));
  const cleanedDirs = await cleanupEmptyDirs(candidates);

  console.error(`\nMoved ${entries.length} session(s) to ${destDir}; cleaned up ${cleanedDirs} empty project dir(s).`);
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
