import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { listJsonlFiles } from '../discover.js';
import {
  resolveIdScope,
  resolveProjectScope,
  copySessionFile,
} from '../session-files.js';
import { loadConfig, resolveSource } from '../config.js';

/**
 * One-way file-level sync of session JSONL files between Claude folders.
 *
 * args: { source, dest, id?, project?, all?, force?, skip-newer? }
 *   - exactly one of {id positional}/--project/--all is required
 *   - source is required; dest defaults to "default"
 *   - id positional accepts a custom-title slug or full session UUID
 *
 * Behavior:
 *   - Pre-flight scans the scope, classifying each source file as
 *     missing/older/conflict/equal vs the corresponding dest file.
 *   - If any conflict (dest mtime > source mtime) and neither
 *     --force nor --skip-newer is set, halts before writing anything.
 *   - --force overrides — copies all (missing + older + conflict).
 *   - --skip-newer copies missing + older, leaves conflicts alone.
 */
export async function run(args) {
  const config = await loadConfig();
  const sourceDir = resolveSource(args.source, config);
  const destDir = resolveSource(args.dest, config);

  if (!validateScope(args)) process.exit(1);
  if (!existsSync(sourceDir)) {
    console.error(`Error: source directory does not exist: ${sourceDir}`);
    process.exit(1);
  }

  const sourceFiles = await collectSourceFiles(args, sourceDir);
  if (sourceFiles.length === 0) {
    console.error('Error: no matching sessions in source.');
    process.exit(1);
  }

  const classified = await classify(sourceFiles, sourceDir, destDir);
  const conflicts = classified.conflict;

  if (conflicts.length > 0 && !args.force && !args['skip-newer']) {
    console.error(`Error: ${conflicts.length} file(s) in dest are newer than source. Re-run with --force (overwrite) or --skip-newer (copy the rest).\n`);
    for (const c of conflicts) {
      console.error(`${c.relPath}\tdest: ${c.destMtime.toISOString()}\tsource: ${c.sourceMtime.toISOString()}`);
    }
    process.exit(1);
  }

  let copied = 0;
  let skipped = 0;

  for (const f of classified.missing) {
    await copySessionFile(f);
    copied++;
  }
  for (const f of classified.older) {
    await copySessionFile(f);
    copied++;
  }
  for (const f of conflicts) {
    if (args.force) {
      await copySessionFile(f);
      copied++;
    } else {
      // --skip-newer is the only way to reach here without halting above.
      skipped++;
    }
  }

  console.log(`Copied ${copied}, skipped ${skipped}, conflicts ${conflicts.length}, equal ${classified.equal.length}`);
}

function validateScope(args) {
  const scopes = [args.id, args.project, args.all].filter(Boolean);
  if (scopes.length === 1) return true;
  console.error('Error: pass exactly one of <id> (positional slug/uuid), --project, or --all.');
  return false;
}

async function collectSourceFiles(args, sourceDir) {
  if (args.all) {
    return listJsonlFiles(join(sourceDir, 'projects'));
  }

  if (args.id) {
    const matched = await resolveIdScope(args.id, sourceDir);
    if (matched.length === 0) {
      console.error(`Error: no session in source matches slug or id '${args.id}'.`);
      process.exit(1);
    }
    return matched;
  }

  // --project: exact display-name match, or anchored glob if it contains '*'
  const matched = await resolveProjectScope(args.project, sourceDir);
  if (matched.length === 0) {
    console.error(`Error: no sessions in project '${args.project}' (run \`session-export list\` to see available project names).`);
    process.exit(1);
  }
  return matched;
}

async function classify(sourceFiles, sourceDir, destDir) {
  const sourceProjects = join(sourceDir, 'projects');
  const destProjects = join(destDir, 'projects');

  const missing = [];
  const older = [];
  const conflict = [];
  const equal = [];

  for (const sourcePath of sourceFiles) {
    const relPath = sourcePath.slice(sourceProjects.length + 1);
    const destPath = join(destProjects, relPath);
    const sourceStat = await stat(sourcePath);
    const sourceMtime = sourceStat.mtime;

    let destStat;
    try {
      destStat = await stat(destPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        missing.push({ sourcePath, destPath, relPath, sourceMtime });
        continue;
      }
      throw err;
    }

    const destMtime = destStat.mtime;
    const entry = { sourcePath, destPath, relPath, sourceMtime, destMtime };

    if (sourceMtime.getTime() === destMtime.getTime()) {
      equal.push(entry);
    } else if (sourceMtime > destMtime) {
      older.push(entry);
    } else {
      conflict.push(entry);
    }
  }

  return { missing, older, conflict, equal };
}
