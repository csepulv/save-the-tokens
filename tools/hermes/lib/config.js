// Parse and validate the hermes container YAML config into a normalized object.
//
// File keys are snake_case (external contract); the normalized object uses
// camelCase. `~` is expanded to the home directory in path-valued fields.

import { readFile as fsReadFile } from 'node:fs/promises';
import os from 'node:os';
import yaml from 'js-yaml';

const HOME = os.homedir();
const MOUNT_MODES = new Set(['rw', 'ro']);
const PORT_KEYS = ['gateway', 'dashboard', 'ssh'];

const expandHome = (value) => {
  if (typeof value !== 'string') return value;
  if (value === '~') return HOME;
  return value.startsWith('~/') ? `${HOME}/${value.slice(2)}` : value;
};

function requireString(raw, key) {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`config: \`${key}\` is required and must be a non-empty string`);
  }
  return value;
}

function normalizeSsh(raw) {
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
  if (ssh.authorized_key !== undefined) result.authorizedKey = expandHome(ssh.authorized_key);
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

function normalizeMount(entry, index) {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`config: mounts[${index}] must be a mapping`);
  }
  if (typeof entry.host !== 'string' || entry.host.trim() === '') {
    throw new Error(`config: mounts[${index}].host is required`);
  }
  if (!MOUNT_MODES.has(entry.mode)) {
    throw new Error(`config: mounts[${index}].mode must be 'rw' or 'ro' (got '${entry.mode}')`);
  }
  const host = expandHome(entry.host);
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

function normalizeMounts(raw) {
  const mounts = raw.mounts ?? [];
  if (!Array.isArray(mounts)) throw new Error('config: `mounts` must be a list');
  return mounts.map(normalizeMount);
}

function normalizeEnv(raw) {
  const env = raw.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('config: `env` must be a mapping');
  }
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]));
}

export function validateConfig(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config: file is empty or not a YAML mapping');
  }
  const launchOnBoot = raw.launch_on_boot ?? true;
  if (typeof launchOnBoot !== 'boolean') {
    throw new Error('config: `launch_on_boot` must be true or false');
  }
  return {
    containerName: requireString(raw, 'container_name'),
    hermesWorkspace: expandHome(requireString(raw, 'hermes_workspace')),
    launchOnBoot,
    ports: normalizePorts(raw),
    ssh: normalizeSsh(raw),
    env: normalizeEnv(raw),
    mounts: normalizeMounts(raw),
  };
}

export async function loadConfig(configPath, deps = {}) {
  const { readFile = fsReadFile } = deps;
  let text;
  try {
    text = await readFile(configPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`config: file not found: ${configPath}`);
    throw err;
  }
  return validateConfig(yaml.load(text));
}
