// config.js — Parse and resolve an agent.yml container config.
//
// Port of config.sh's yq/jq helpers. The agent.yml schema is unchanged
// (see agent.yml.example); this resolves it into the structured shape the
// launch/sync commands consume.

import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

import { resolveConfigPath } from './paths.js';
import { normalizeResources } from './resources.js';

import {
  AGENT_HOME,
  CONTAINER_PREFIX,
  WORKSPACE_MOUNT,
  REFERENCE_MOUNT,
  MCP_MOUNT,
  CLAUDE_CONTAINER_PATH,
} from './constants.js';

// The tool's own directory (package root) — sibling fallback for config
// auto-detection, mirroring config.sh's TOOLS_DIR.
const TOOL_DIR = fileURLToPath(new URL('..', import.meta.url));

const listAgentConfigsIn = (dir) => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.agent.yml'))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
};

// Locate the agent config file: explicit path, then a single *.agent.yml in
// cwd, then a single one in the tool dir. Errors when ambiguous or absent —
// the helper owns the messaging (caller just exits).
export function resolveConfigFile(explicit, deps = {}) {
  const {
    cwd = process.cwd(),
    toolDir = TOOL_DIR,
    fileExists = existsSync,
    listAgentConfigs = listAgentConfigsIn,
  } = deps;

  if (explicit) {
    if (!fileExists(explicit)) throw new Error(`Config file not found: ${explicit}`);
    return explicit;
  }

  for (const [dir, label] of [[cwd, 'cwd'], [toolDir, toolDir]]) {
    const matches = listAgentConfigs(dir);
    if (matches.length > 1) {
      throw new Error(`Multiple *.agent.yml files in ${label}. Use --config <file>.`);
    }
    if (matches.length === 1) return matches[0];
  }
  throw new Error(`No *.agent.yml found in cwd or ${toolDir}. Use --config <file>.`);
}

// The config's lifecycle mode: 'daemon' (emit a compose) or 'interactive'
// (default — run a container). A cheap peek so launch can route before the
// interactive-specific parse/validation.
export function readConfigMode(configFile, deps = {}) {
  const { readFile = (f) => readFileSync(f, 'utf-8') } = deps;
  const raw = yaml.load(readFile(configFile)) || {};
  return raw.mode || 'interactive';
}

// Container name default derived from the config filename:
//   tsugi.agent.yml → agent-tsugi
export function defaultContainerNameFromConfig(configFile) {
  const base = basename(configFile).replace(/\.agent\.yml$/, '');
  return `${CONTAINER_PREFIX}-${base}`;
}

// Resolve one mount spec to { host, mode, containerPath, name }.
// Host forms: /absolute, ~/home, or relative to the config dir
// (./same-folder, ../sibling). Relative paths are canonicalized and must
// exist (resolveConfigPath canonicalize).
function resolveMount(spec, deps) {
  const { home, baseDir, realpath } = deps;
  const { host: rawHost, mode, target } = spec;

  let host;
  try {
    host = resolveConfigPath(rawHost, { home, baseDir, realpath, canonicalize: true });
  } catch {
    throw new Error(`Cannot resolve path: ${rawHost}`);
  }

  const named = (fallback) => target || fallback;
  switch (mode) {
    case 'claude':
      return { host, mode, containerPath: CLAUDE_CONTAINER_PATH, name: named('claude') };
    case 'rw':
      return { host, mode, containerPath: `${WORKSPACE_MOUNT}/${named(basename(host))}`, name: named(basename(host)) };
    case 'ro':
      return { host, mode, containerPath: `${REFERENCE_MOUNT}/${named(basename(host))}`, name: named(basename(host)) };
    case 'mcp':
      return { host, mode, containerPath: `${MCP_MOUNT}/${named(basename(host))}`, name: named(basename(host)) };
    default:
      throw new Error(`Invalid mount mode '${mode}' for ${rawHost}. Use claude/rw/ro/mcp.`);
  }
}

// A bare-number port doubles to host:container; a string passes through.
const normalizePort = (port) =>
  typeof port === 'number' ? `${port}:${port}` : String(port);

const dockerModeFor = (mode) => (mode === 'rw' ? 'rw' : 'ro');

export function parseConfig(configFile, deps = {}) {
  const {
    home = homedir(),
    readFile = (f) => readFileSync(f, 'utf-8'),
    realpath = realpathSync,
    baseDir = dirname(configFile),
  } = deps;

  const raw = yaml.load(readFile(configFile)) || {};
  const resolveDeps = { home, baseDir, realpath };

  const mounts = (raw.mounts || []).map((spec) => resolveMount(spec, resolveDeps));

  // The claude mount names the persistent config dir (≤1 in practice;
  // first wins — used by both sync and launch so the two never disagree).
  const claudeMount = mounts.find((m) => m.mode === 'claude') || null;

  const volumeMounts = mounts
    .filter((m) => m.mode !== 'claude')
    .map((m) => ({ host: m.host, containerPath: m.containerPath, dockerMode: dockerModeFor(m.mode) }));

  const firstRwMount = mounts.find((m) => m.mode === 'rw') || null;

  const explicitName = raw.container_name || '';
  const env = raw.env || {};

  // Optional .env file loaded at runtime (docker run --env-file). Config-relative
  // + must exist; `env:` (-e) overrides it.
  let envFile = null;
  if (raw.env_file) {
    try {
      envFile = resolveConfigPath(raw.env_file, { ...resolveDeps, canonicalize: true });
    } catch {
      throw new Error(`Cannot resolve env_file: ${raw.env_file}`);
    }
  }

  return {
    configFile,
    containerName: explicitName || defaultContainerNameFromConfig(configFile),
    explicitContainerName: explicitName,
    hostnameOverride: raw.hostname || '',
    mounts,
    claudeDir: claudeMount ? claudeMount.host : null,
    firstRw: firstRwMount ? { name: firstRwMount.name, containerPath: firstRwMount.containerPath } : null,
    volumeMounts,
    ports: (raw.ports || []).map(normalizePort),
    env,
    envPairs: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    envFile,
    resources: normalizeResources(raw.resources),
    onStart: raw.on_start || null,
    servicesFile: raw.services || '',
    network: raw.network || '',
    settingsTemplate: raw.settings_template || '',
  };
}
