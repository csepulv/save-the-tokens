import { homedir } from 'os';
import { join, resolve, isAbsolute } from 'path';
import { readdir, stat, rm, mkdir } from 'fs/promises';

const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function getProfilesRoot() {
  return join(homedir(), '.sekko', 'profiles');
}

export function validateProfileName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Profile name is required');
  }
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Must start with a lowercase letter or digit ` +
      `and contain only lowercase letters, digits, underscores, and dashes.`
    );
  }
}

export function expandTilde(path) {
  if (typeof path !== 'string') return path;
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function resolveProfilePath({ profile, userDataDir } = {}) {
  if (profile && userDataDir) {
    throw new Error('Use either --profile or --user-data-dir, not both');
  }
  if (profile) {
    validateProfileName(profile);
    return join(getProfilesRoot(), profile);
  }
  if (userDataDir) {
    const expanded = expandTilde(userDataDir);
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }
  return null;
}

export async function ensureProfilePath(path, deps = {}) {
  const { mkdir: mkdirFn = mkdir } = deps;
  await mkdirFn(path, { recursive: true });
}

export async function listProfiles(deps = {}) {
  const { readdir: readdirFn = readdir, stat: statFn = stat } = deps;
  const root = getProfilesRoot();

  let entries;
  try {
    entries = await readdirFn(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!PROFILE_NAME_PATTERN.test(entry.name)) continue;
    const path = join(root, entry.name);
    let mtime = null;
    try {
      const s = await statFn(path);
      mtime = s.mtime;
    } catch {
      // dir disappeared between readdir and stat — skip
      continue;
    }
    profiles.push({ name: entry.name, path, mtime });
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return profiles;
}

export async function removeProfile(name, deps = {}) {
  const { rm: rmFn = rm, stat: statFn = stat } = deps;
  validateProfileName(name);
  const path = join(getProfilesRoot(), name);

  try {
    await statFn(path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error(`Profile "${name}" not found at ${path}`);
      e.code = 'PROFILE_NOT_FOUND';
      throw e;
    }
    throw err;
  }

  await rmFn(path, { recursive: true, force: true });
  return path;
}
