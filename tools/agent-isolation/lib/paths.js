// paths.js — Resolve paths written in an agent.yml config.
//
// Shared by mounts (config.js), services (launch.js), and settings_template
// (sync.js). Supported forms: /absolute, ~/home, and paths relative to the
// config file's directory (./sibling, ../up, bare). canonicalize=true also
// resolves symlinks/.. via realpath (and throws if the path is missing) —
// the mount behavior; callers that check existence themselves leave it off.

import { isAbsolute, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

export const expandHome = (path, home) =>
  path.startsWith('~/') || path === '~' ? path.replace(/^~/, home) : path;

export function resolveConfigPath(rawPath, { home, baseDir, realpath = realpathSync, canonicalize = false } = {}) {
  const expanded = expandHome(String(rawPath), home);
  if (isAbsolute(expanded)) return expanded;
  const resolved = resolve(baseDir, expanded);
  return canonicalize ? realpath(resolved) : resolved;
}
