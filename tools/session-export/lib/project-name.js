import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';

const cache = new Map();
const fullPathCache = new Map();

/**
 * Resolve an encoded project dirname (e.g. "-Users-you-projects-my-app")
 * back to a real filesystem path by greedy segment matching.
 *
 * Returns the "meaningful" portion — path segments after the user's home directory.
 * Falls back to naive split-on-dash if the filesystem can't resolve it.
 */
export async function resolveProjectName(encodedDirname, deps = {}) {
  if (cache.has(encodedDirname)) return cache.get(encodedDirname);

  const result = await resolve(encodedDirname, deps);
  cache.set(encodedDirname, result);
  return result;
}

/**
 * Like resolveProjectName, but returns the full absolute path (not home-stripped).
 * E.g. "-Users-you-projects-foo" → "/Users/you/projects/foo".
 */
export async function resolveProjectFullPath(encodedDirname, deps = {}) {
  if (fullPathCache.has(encodedDirname)) return fullPathCache.get(encodedDirname);

  const { homedir: home = homedir } = deps;
  const relative = await resolveProjectName(encodedDirname, deps);
  // If resolveProjectName returned an absolute path (couldn't strip home), pass through.
  const full = relative.startsWith('/') ? relative : `${home()}/${relative}`;
  fullPathCache.set(encodedDirname, full);
  return full;
}

export function clearCache() {
  cache.clear();
  fullPathCache.clear();
}

async function resolve(encodedDirname, deps) {
  const { stat: statFn = stat, homedir: home = homedir } = deps;
  const raw = encodedDirname.replace(/^-/, '');
  const segments = raw.split('-');

  const resolvedParts = [];
  let i = 0;

  while (i < segments.length) {
    let matched = false;

    // Try longest possible segment first (greedy)
    for (let end = segments.length; end > i; end--) {
      const candidate = '/' + resolvedParts.concat(segments.slice(i, end).join('-')).join('/');
      try {
        await statFn(candidate);
        resolvedParts.push(segments.slice(i, end).join('-'));
        i = end;
        matched = true;
        break;
      } catch {
        continue;
      }
    }

    if (!matched) {
      // Can't resolve — append remaining segments individually
      resolvedParts.push(...segments.slice(i));
      break;
    }
  }

  const fullPath = '/' + resolvedParts.join('/');
  return stripHomePrefix(fullPath, home());
}

function stripHomePrefix(resolvedPath, homeDir) {
  if (resolvedPath.startsWith(homeDir)) {
    return resolvedPath.slice(homeDir.length + 1);
  }
  return resolvedPath;
}
