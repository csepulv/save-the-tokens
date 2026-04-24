import { basename } from 'node:path';

export function groupByProject(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = entry.project || '(unknown)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

export function filterProjects(byProject, filter) {
  if (!filter) return byProject;
  const lower = filter.toLowerCase();
  const result = new Map();
  for (const [project, entries] of byProject) {
    if (project.toLowerCase().includes(lower)) {
      result.set(project, entries);
    }
  }
  return result;
}

/**
 * Map each full project path to a flat output folder name (its basename).
 * If two different paths share the same basename, both fall back to a
 * full-path name with slashes replaced by dashes to avoid collisions.
 */
export function buildFlatNames(byProject) {
  const flatNames = new Map();
  const seenFlat = new Map(); // flat name → first project path that claimed it

  for (const projectPath of byProject.keys()) {
    const flat = basename(projectPath) || projectPath;
    if (seenFlat.has(flat)) {
      const existing = seenFlat.get(flat);
      flatNames.set(existing, slugifyPath(existing));
      flatNames.set(projectPath, slugifyPath(projectPath));
    } else {
      seenFlat.set(flat, projectPath);
      flatNames.set(projectPath, flat);
    }
  }

  return flatNames;
}

export function slugifyPath(projectPath) {
  return projectPath.replace(/\//g, '-');
}

export function uniqueSlug(slug, sessionId, usedSlugs) {
  if (!usedSlugs.has(slug)) return slug;
  return `${slug}-${sessionId.slice(0, 8)}`;
}

/**
 * Filter entries by date range (inclusive on both ends).
 * afterDate and beforeDate are Date objects or null.
 */
export function filterByDate(entries, afterDate, beforeDate) {
  if (!afterDate && !beforeDate) return entries;
  return entries.filter(({ date }) => {
    if (afterDate && date < afterDate) return false;
    if (beforeDate && date > beforeDate) return false;
    return true;
  });
}
