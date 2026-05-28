import { mkdir, copyFile, stat, utimes, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  listJsonlFiles,
  findJsonlByExactTitle,
  extractEncodedProjectDir,
} from './discover.js';
import { resolveProjectName } from './project-name.js';

/**
 * Shared session-file operations for the commands that move JSONL files
 * between Claude folders — `merge`, `remove`, `copy`, `move`. Locating
 * sessions by selector, copying them mtime-faithfully, and cleaning up
 * project dirs they leave empty.
 *
 * Each command keeps its own `run()` flow and user-facing messages; this
 * module owns only the logic they genuinely share.
 */

/**
 * Resolve a session selector to matching JSONL paths within one source.
 *
 * The selector is exact: a full session UUID (filename match) or an exact
 * custom-title slug. Substring matches are deliberately rejected — a
 * destructive or file-moving op shouldn't silently broaden scope.
 *
 * Returns `[]` on no match (the caller decides what absence means). Exits
 * non-zero on ambiguity — the same id under multiple project dirs, or a
 * slug shared by multiple sessions — since no caller can safely proceed.
 */
export async function resolveIdScope(query, sourceDir) {
  const allPaths = await listJsonlFiles(join(sourceDir, 'projects'));

  const idMatches = allPaths.filter((p) => p.endsWith(`/${query}.jsonl`));
  if (idMatches.length === 1) return idMatches;
  if (idMatches.length > 1) {
    console.error(`Error: session id '${query}' appears in ${idMatches.length} projects. Pick one explicitly.`);
    for (const p of idMatches) console.error(p);
    process.exit(1);
  }

  const titleMatches = await findJsonlByExactTitle(query, sourceDir);
  if (titleMatches.length > 1) {
    console.error(`Error: slug '${query}' matches ${titleMatches.length} sessions in source. Use a session id instead.`);
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

/**
 * Resolve a project selector to matching JSONL paths within one source.
 * Exact display-name match, or anchored-glob match when the pattern
 * contains `*` (the only glob metacharacter — every other regex special
 * is treated literally). Returns `[]` on no match.
 */
export async function resolveProjectScope(pattern, sourceDir) {
  const isGlob = pattern.includes('*');
  const matcher = isGlob ? globToRegex(pattern) : null;
  const allPaths = await listJsonlFiles(join(sourceDir, 'projects'));

  const matched = [];
  for (const p of allPaths) {
    const encoded = extractEncodedProjectDir(p);
    const project = encoded ? await resolveProjectName(encoded) : '';
    if (isGlob ? matcher.test(project) : project === pattern) {
      matched.push(p);
    }
  }
  return matched;
}

function globToRegex(pattern) {
  // Escape every regex special EXCEPT `*`, then convert `*` to `.*`.
  // Only `*` is treated as glob; `?`, `.`, parens, etc. are all literal.
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
}

/**
 * Resolve a copy/move scope — exactly one of `args.id` / `args.project`,
 * already validated by the caller — to source JSONL paths.
 */
export async function collectScopeFiles(args, sourceDir) {
  if (args.id) return resolveIdScope(args.id, sourceDir);
  return resolveProjectScope(args.project, sourceDir);
}

/**
 * Build copy entries from source JSONL paths: each one's dest path under
 * `<destDir>/projects/` mirrors its relative location under the source,
 * paired with the source mtime so the copy can preserve it.
 */
export async function buildCopyEntries(sourcePaths, sourceDir, destDir) {
  const sourceProjects = join(sourceDir, 'projects');
  const destProjects = join(destDir, 'projects');

  const entries = [];
  for (const sourcePath of sourcePaths) {
    const relPath = sourcePath.slice(sourceProjects.length + 1);
    const destPath = join(destProjects, relPath);
    const { mtime } = await stat(sourcePath);
    entries.push({ sourcePath, destPath, relPath, sourceMtime: mtime });
  }
  return entries;
}

/**
 * Copy one session JSONL file, creating dest project dirs as needed.
 * Preserves the source mtime — session mtime is meaningful (it drives
 * `list` ordering and `stats` windowing), and `copyFile` would otherwise
 * stamp the dest "now".
 */
export async function copySessionFile({ sourcePath, destPath, sourceMtime }) {
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(sourcePath, destPath);
  await utimes(destPath, sourceMtime, sourceMtime);
}

/**
 * Remove encoded project dirs left empty after their sessions were
 * deleted. `candidates` carry `{ sourceDir, encoded }`. Returns the count
 * of dirs removed.
 */
export async function cleanupEmptyDirs(candidates) {
  const dirsBySource = new Map();
  for (const c of candidates) {
    if (!c.encoded) continue;
    if (!dirsBySource.has(c.sourceDir)) dirsBySource.set(c.sourceDir, new Set());
    dirsBySource.get(c.sourceDir).add(c.encoded);
  }

  let cleaned = 0;
  for (const [sourceDir, encodedSet] of dirsBySource) {
    for (const encoded of encodedSet) {
      const dirPath = join(sourceDir, 'projects', encoded);
      if (await isProjectDirEmpty(dirPath)) {
        await rm(dirPath, { recursive: true, force: true });
        cleaned++;
      }
    }
  }
  return cleaned;
}

// "Empty" means: no remaining files, and any subagents/ subdir is itself
// empty. A subagents/ dir with content blocks cleanup so we don't lose
// agent traces alongside the session JSONLs.
async function isProjectDirEmpty(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'subagents') {
      const sub = await readdir(join(dirPath, entry.name));
      if (sub.length > 0) return false;
      continue;
    }
    return false;
  }
  return true;
}
