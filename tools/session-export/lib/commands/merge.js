import { existsSync } from 'node:fs';
import { mkdir, copyFile, stat, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  listJsonlFiles,
  findJsonlByExactTitle,
  extractEncodedProjectDir,
} from '../discover.js';
import { resolveProjectName } from '../project-name.js';
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
    await copyOne(f);
    copied++;
  }
  for (const f of classified.older) {
    await copyOne(f);
    copied++;
  }
  for (const f of conflicts) {
    if (args.force) {
      await copyOne(f);
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
    return resolveSessionScope(args.id, sourceDir);
  }

  // --project: exact display-name match
  const allPaths = await listJsonlFiles(join(sourceDir, 'projects'));
  const matched = [];
  for (const p of allPaths) {
    const encoded = extractEncodedProjectDir(p);
    const project = encoded ? await resolveProjectName(encoded) : '';
    if (project === args.project) matched.push(p);
  }
  if (matched.length === 0) {
    console.error(`Error: no sessions in project '${args.project}' (exact match against display name; run \`session-export list\` to see available project names).`);
    process.exit(1);
  }
  return matched;
}

// --session accepts a slug (custom title, exact match) or a session id
// (exact filename match — full UUID, not a substring). Substring matching
// would silently mask ambiguity in a destructive op.
async function resolveSessionScope(query, sourceDir) {
  // Exact id match — filename === `${query}.jsonl`
  const allPaths = await listJsonlFiles(join(sourceDir, 'projects'));
  const idMatches = allPaths.filter((p) => p.endsWith(`/${query}.jsonl`));
  if (idMatches.length === 1) return idMatches;
  if (idMatches.length > 1) {
    // Same id under multiple encoded dirs — rare, but list and halt.
    console.error(`Error: session id '${query}' appears in ${idMatches.length} projects. Pick one explicitly.`);
    for (const p of idMatches) console.error(p);
    process.exit(1);
  }

  // Otherwise treat as exact title (slug)
  const titleMatches = await findJsonlByExactTitle(query, sourceDir);
  if (titleMatches.length === 0) {
    console.error(`Error: no session in source matches slug or id '${query}'.`);
    process.exit(1);
  }
  if (titleMatches.length > 1) {
    console.error(`Error: slug '${query}' matches ${titleMatches.length} sessions in source. Use a session id instead.\n`);
    for (const p of titleMatches) {
      const id = p.split('/').pop().replace('.jsonl', '');
      const encoded = extractEncodedProjectDir(p);
      const project = encoded ? await resolveProjectName(encoded) : '';
      console.error(`${id}\t${project}`);
    }
    process.exit(1);
  }
  return titleMatches;
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

async function copyOne(entry) {
  await mkdir(dirname(entry.destPath), { recursive: true });
  await copyFile(entry.sourcePath, entry.destPath);
  // Preserve mtime so a re-run sees `equal`, not a false conflict.
  // copyFile sets dest mtime to "now" by default; that would make every
  // freshly-copied file look newer than its source on the next merge.
  await utimes(entry.destPath, entry.sourceMtime, entry.sourceMtime);
}
