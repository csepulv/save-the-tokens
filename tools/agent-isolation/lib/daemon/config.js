// daemon/config.js — Parse + validate the daemon (hermes-style) container
// config into a normalized object. File keys are snake_case; the normalized
// object is camelCase; `~` expands to home in path-valued fields.
//
// Copied from the former tools/hermes/lib/config.js (M3a copy phase). `loadConfig` is
// sync (agent-isolation is all-sync); validation is verbatim. Convergence
// with the interactive config model is M3c.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { resolveConfigPath } from '../paths.js';
import { normalizeResources } from '../resources.js';

const HOME = os.homedir();
const MOUNT_MODES = new Set(['rw', 'ro']);
const PORT_KEYS = ['gateway', 'dashboard', 'ssh'];

function requireString(raw, key) {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`config: \`${key}\` is required and must be a non-empty string`);
  }
  return value;
}

function normalizeSsh(raw, resolvePath) {
  const ssh = raw.ssh ?? {};
  if (typeof ssh !== 'object' || Array.isArray(ssh)) {
    throw new Error('config: `ssh` must be a mapping');
  }
  const enabled = ssh.enabled ?? true;
  if (typeof enabled !== 'boolean') {
    throw new Error('config: `ssh.enabled` must be true or false');
  }
  if (enabled && !ssh.password && !ssh.authorized_key) {
    throw new Error(
      'config: `ssh` is enabled (default) but no `ssh.password` or `ssh.authorized_key` set — '
      + 'add one, or set `ssh.enabled: false`',
    );
  }
  const result = { enabled };
  if (ssh.password !== undefined) result.password = String(ssh.password);
  if (ssh.authorized_key !== undefined) {
    try {
      result.authorizedKey = resolvePath(ssh.authorized_key, true);
    } catch {
      throw new Error(`config: ssh.authorized_key not found: ${ssh.authorized_key}`);
    }
  }
  return result;
}

function normalizePorts(raw) {
  const ports = raw.ports ?? {};
  if (typeof ports !== 'object' || Array.isArray(ports)) {
    throw new Error('config: `ports` must be a mapping');
  }
  const result = {};
  for (const key of PORT_KEYS) {
    if (ports[key] === undefined) continue;
    const port = ports[key];
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`config: \`ports.${key}\` must be an integer between 1 and 65535`);
    }
    result[key] = port;
  }
  return result;
}

function normalizeMount(entry, index, resolvePath) {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`config: mounts[${index}] must be a mapping`);
  }
  if (typeof entry.host !== 'string' || entry.host.trim() === '') {
    throw new Error(`config: mounts[${index}].host is required`);
  }
  if (!MOUNT_MODES.has(entry.mode)) {
    throw new Error(`config: mounts[${index}].mode must be 'rw' or 'ro' (got '${entry.mode}')`);
  }
  // Resolve config-relative + require existence (relative paths only — absolute/~
  // pass through). Matches the interactive `resolveMount`.
  let host;
  try {
    host = resolvePath(entry.host, true);
  } catch {
    throw new Error(`config: mounts[${index}].host not found: ${entry.host}`);
  }
  const root = entry.mode === 'rw' ? '/workspace' : '/reference';
  const { target } = entry;
  let containerPath;
  if (target === undefined || target === '') {
    containerPath = `${root}/${host.split('/').pop()}`;
  } else if (typeof target !== 'string') {
    throw new Error(`config: mounts[${index}].target must be a string`);
  } else {
    containerPath = target.startsWith('/') ? target : `${root}/${target}`;
  }
  if (containerPath === '/opt/data' || containerPath.startsWith('/opt/data/')) {
    throw new Error(
      `config: mounts[${index}] target '${containerPath}' would shadow the Hermes mount at /opt/data`,
    );
  }
  return { host, mode: entry.mode, containerPath };
}

function normalizeMounts(raw, resolvePath) {
  const mounts = raw.mounts ?? [];
  if (!Array.isArray(mounts)) throw new Error('config: `mounts` must be a list');
  return mounts.map((entry, index) => normalizeMount(entry, index, resolvePath));
}

function normalizeEnv(raw) {
  const env = raw.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('config: `env` must be a mapping');
  }
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]));
}

// Optional path to a .env file the container loads at runtime (compose
// `env_file:`). Config-relative + must exist. `env:` overrides it (compose
// `environment:` wins over `env_file:`), so put secrets here, overrides in `env:`.
function normalizeEnvFile(raw, resolvePath) {
  if (raw.env_file === undefined) return undefined;
  if (typeof raw.env_file !== 'string' || raw.env_file.trim() === '') {
    throw new Error('config: `env_file` must be a non-empty string');
  }
  try {
    return resolvePath(raw.env_file, true);
  } catch {
    throw new Error(`config: env_file not found: ${raw.env_file}`);
  }
}

// Optional per-container image extension. When set, the emitted compose gets a
// `build:` block (FROM the daemon base + extra tools) instead of a bare base
// `image:`. Paths resolve relative to the config file's directory (./sibling,
// ../up, ~/home, absolute) via the shared `resolveConfigPath` — so a Dockerfile
// next to the config works as `./Dockerfile`, and the emitted compose carries an
// absolute context (it lives in the workspace, a different dir).
function normalizeBuild(raw, resolvePath) {
  const build = raw.build;
  if (build === undefined) return undefined;
  if (typeof build !== 'object' || Array.isArray(build) || build === null) {
    throw new Error('config: `build` must be a mapping');
  }
  if (typeof build.dockerfile !== 'string' || build.dockerfile.trim() === '') {
    throw new Error('config: `build.dockerfile` is required when `build` is set');
  }
  if (build.context !== undefined && (typeof build.context !== 'string' || build.context.trim() === '')) {
    throw new Error('config: `build.context` must be a non-empty string');
  }
  if (build.args !== undefined && (typeof build.args !== 'object' || Array.isArray(build.args))) {
    throw new Error('config: `build.args` must be a mapping');
  }
  // No canonicalize — emit.js checks the Dockerfile exists (gives a friendlier
  // error and tolerates a not-yet-built context dir).
  const result = { dockerfile: resolvePath(build.dockerfile) };
  if (build.context !== undefined) result.context = resolvePath(build.context);
  if (build.args !== undefined) {
    result.args = Object.fromEntries(Object.entries(build.args).map(([k, v]) => [k, String(v)]));
  }
  return result;
}

export function validateConfig(raw, baseDir = process.cwd(), { realpath = realpathSync } = {}) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config: file is empty or not a YAML mapping');
  }
  const launchOnBoot = raw.launch_on_boot ?? true;
  if (typeof launchOnBoot !== 'boolean') {
    throw new Error('config: `launch_on_boot` must be true or false');
  }
  // One resolver for every path field: config-dir-relative → absolute, ~ → home,
  // absolute passes through. canonicalize=true also realpaths + requires the path
  // to exist (relative paths only). `hermes_workspace` omits it — the tool creates it.
  const resolvePath = (p, canonicalize = false) =>
    resolveConfigPath(p, { home: HOME, baseDir, realpath, canonicalize });
  const build = normalizeBuild(raw, resolvePath);
  const envFile = normalizeEnvFile(raw, resolvePath);
  const resources = normalizeResources(raw.resources);
  return {
    containerName: requireString(raw, 'container_name'),
    hermesWorkspace: resolvePath(requireString(raw, 'hermes_workspace')),
    launchOnBoot,
    ports: normalizePorts(raw),
    ssh: normalizeSsh(raw, resolvePath),
    env: normalizeEnv(raw),
    mounts: normalizeMounts(raw, resolvePath),
    ...(build && { build }),
    ...(envFile && { envFile }),
    ...(resources && { resources }),
  };
}

export function loadConfig(configPath, deps = {}) {
  const { readFile = (p) => readFileSync(p, 'utf-8'), realpath = realpathSync } = deps;
  let text;
  try {
    text = readFile(configPath);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`config: file not found: ${configPath}`);
    throw err;
  }
  return validateConfig(yaml.load(text), dirname(configPath), { realpath });
}
