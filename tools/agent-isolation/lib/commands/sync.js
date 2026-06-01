// commands/sync.js — Sync ~/.claude/ to the agent-claude dir with transforms.
//
// Faithful port of sync-config.sh's five phases:
//   A) rsync with exclusions (settings.json excluded — composed in B)
//   B) compose container settings.json (template + whitelisted host fields)
//   C) path rewriting across the synced config files (replaces jq+sed)
//   D) MCP server injection for enabled external plugins
//   E) warn about host paths still uncovered by any mount
//
// Real fs/rsync by default; `log` is injectable so tests can run it silently.

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { parseConfig, resolveConfigFile } from '../config.js';
import { resolveConfigPath } from '../paths.js';
import { ALWAYS_EXCLUDE as SHARED_ALWAYS_EXCLUDE, SESSION_EXCLUDE } from '../claude-excludes.js';
import { AGENT_HOME } from '../constants.js';
import { composeSettings } from '../sync/settings.js';
import { buildMappings, rewritePaths } from '../sync/rewrite-paths.js';
import { selectedPluginNames, injectMcp } from '../sync/mcp-inject.js';
import { firstUnmappedHomePath } from '../sync/warn-unmapped.js';

const TOOL_DIR = fileURLToPath(new URL('../../', import.meta.url));

// Shared base (claude-excludes.js) + '/settings.json' (interactive composes
// settings.json separately in Phase B, so it's excluded from the rsync).
const ALWAYS_EXCLUDE = [...SHARED_ALWAYS_EXCLUDE, '/settings.json'];
const WRITE_DIRS = ['projects', 'sessions', 'backups', 'plans', 'tasks', 'todos', 'cache'];
const REWRITE_TARGETS = ['plugins/installed_plugins.json', 'plugins/known_marketplaces.json', 'settings.json', '.claude.json'];
const WARN_TARGETS = ['plugins/installed_plugins.json', 'plugins/known_marketplaces.json', 'settings.json'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// Resolve a tool-dir template path: live file wins over .example.
const resolveTemplate = (live, example) => {
  if (existsSync(join(TOOL_DIR, live))) return { path: join(TOOL_DIR, live), isExample: false };
  if (existsSync(join(TOOL_DIR, example))) return { path: join(TOOL_DIR, example), isExample: true };
  return null;
};

// Resolve the settings.json template. An explicit `settings_template` from
// the config resolves config-dir-relative (/ ~ / ./ ../), with a bare-name
// tool-dir fallback for back-compat; a set-but-missing value errors. With no
// config value, fall back to the tool-dir default (live > .example).
function resolveSettingsTemplate(settingsTemplate, { configDir, home }) {
  if (!settingsTemplate) {
    return resolveTemplate('settings.container.json', 'settings.container.json.example');
  }
  const resolved = resolveConfigPath(settingsTemplate, { home, baseDir: configDir });
  if (existsSync(resolved)) return { path: resolved, isExample: false };
  if (!settingsTemplate.includes('/')) {
    const toolPath = join(TOOL_DIR, settingsTemplate);
    if (existsSync(toolPath)) return { path: toolPath, isExample: false };
  }
  throw new Error(`settings_template not found: ${settingsTemplate}`);
}

export function syncConfig(options = {}, deps = {}) {
  const {
    configArg = '',
    sourceDir = '',
    force = false,
    headless = false,
    includeAll = false,
  } = options;
  const {
    log = console.log,
    warn = (msg) => console.error(msg),
    home = process.env.HOME || homedir(),
    rsync = (args) => execFileSync('rsync', args, { stdio: 'inherit' }),
  } = deps;

  const hostClaude = sourceDir ? sourceDir.replace(/^~/, home) : join(home, '.claude');

  const configFile = resolveConfigFile(configArg, { ...deps });
  const cfg = parseConfig(configFile, { home });
  const agentConfigDir = cfg.claudeDir;

  if (!agentConfigDir) {
    log(`Warning: No 'claude' mount in ${configFile}.`);
    log('  Container will use ephemeral ~/.claude (not preserved between runs).');
    log('  Add a mount with mode: claude to persist config, sessions, and history.');
    return;
  }
  if (!existsSync(hostClaude)) throw new Error(`${hostClaude} not found`);

  if (existsSync(agentConfigDir) && force) {
    log(`Wiping existing config at ${agentConfigDir} (--force)`);
    rmSync(agentConfigDir, { recursive: true, force: true });
  }

  log(`Syncing ${hostClaude} → ${agentConfigDir}`);

  phaseA({ hostClaude, agentConfigDir, includeAll, rsync, log });
  phaseB({ agentConfigDir, hostClaude, settingsTemplate: cfg.settingsTemplate, configDir: dirname(configFile), home, log });
  phaseC({ agentConfigDir, hostClaude, mounts: cfg.mounts, log });
  phaseD({ agentConfigDir, headless, log });
  phaseE({ agentConfigDir, home, warn });

  log(`\nDone. Config ready at ${agentConfigDir}`);
}

// ── Phase A: rsync with exclusions ─────────────────────────────────
function phaseA({ hostClaude, agentConfigDir, includeAll, rsync, log }) {
  mkdirSync(agentConfigDir, { recursive: true });

  const excludes = [...ALWAYS_EXCLUDE, ...(includeAll ? [] : SESSION_EXCLUDE)];
  const args = ['-a', ...excludes.map((e) => `--exclude=${e}`), `${hostClaude}/`, `${agentConfigDir}/`];
  rsync(args);
  if (!includeAll) log('  excluding session data (use --include-all to copy everything)');
  log('  synced config');

  const credentials = join(hostClaude, '.credentials.json');
  if (existsSync(credentials)) {
    cpSync(credentials, join(agentConfigDir, '.credentials.json'));
    log('  copied .credentials.json');
  }

  for (const dir of WRITE_DIRS) mkdirSync(join(agentConfigDir, dir), { recursive: true });

  // Container-side local-additional-context.md (environment facts for the
  // in-container agent). settings_template config key is intentionally NOT
  // honored here — see plan Decisions (parity with the bash, which ignores it).
  const ctx = resolveTemplate('local-additional-context.md', 'local-additional-context.md.example');
  if (ctx) {
    mkdirSync(join(agentConfigDir, 'rules'), { recursive: true });
    cpSync(ctx.path, join(agentConfigDir, 'rules', 'local-additional-context.md'));
    log('  wrote rules/local-additional-context.md (container content)');
  }
}

// ── Phase B: compose settings.json ─────────────────────────────────
function phaseB({ agentConfigDir, hostClaude, settingsTemplate, configDir, home, log }) {
  const template = resolveSettingsTemplate(settingsTemplate, { configDir, home });
  if (!template) throw new Error(`No settings.container.json[.example] template in ${TOOL_DIR}.`);
  if (template.isExample) log('  using settings.container.json.example (copy to settings.container.json to customize)');

  const hostSettings = join(hostClaude, 'settings.json');
  const composed = composeSettings(readJson(template.path), existsSync(hostSettings) ? readJson(hostSettings) : null);
  writeJson(join(agentConfigDir, 'settings.json'), composed);
  log(existsSync(hostSettings)
    ? '  composed settings.json (template + host overlay)'
    : '  copied template to settings.json (no host settings.json to overlay)');
}

// ── Phase C: path rewriting ────────────────────────────────────────
function phaseC({ agentConfigDir, hostClaude, mounts, log }) {
  const mappings = buildMappings(hostClaude, mounts, AGENT_HOME);
  for (const rel of REWRITE_TARGETS) {
    const file = join(agentConfigDir, rel);
    if (!existsSync(file)) continue;
    writeJson(file, rewritePaths(readJson(file), mappings));
    log(`  rewrote paths in ${basename(file)}`);
  }
}

// ── Phase D: MCP injection ─────────────────────────────────────────
function phaseD({ agentConfigDir, headless, log }) {
  const settingsFile = join(agentConfigDir, 'settings.json');
  if (!existsSync(settingsFile)) {
    log('  Warning: settings.json not found, skipping MCP injection');
    return;
  }
  const settings = readJson(settingsFile);
  const selected = selectedPluginNames(settings);

  const parsedMcp = [];
  for (const mcpFile of findMcpFiles(join(agentConfigDir, 'plugins', 'marketplaces'))) {
    const pluginName = basename(dirname(mcpFile));
    if (selected.has(pluginName)) {
      parsedMcp.push(readJson(mcpFile));
      log(`  injected MCP: ${pluginName}`);
    }
  }

  writeJson(settingsFile, injectMcp(settings, parsedMcp, { headless }));
  if (headless) log('  stripped statusLine (headless mode)');
  log('  updated settings.json');
}

// marketplaces/*/external_plugins/*/.mcp.json, lexically sorted (shell-glob order).
function findMcpFiles(marketplacesDir) {
  if (!existsSync(marketplacesDir)) return [];
  const files = [];
  for (const market of readdirSync(marketplacesDir).sort()) {
    const externalDir = join(marketplacesDir, market, 'external_plugins');
    if (!existsSync(externalDir)) continue;
    for (const plugin of readdirSync(externalDir).sort()) {
      const mcpFile = join(externalDir, plugin, '.mcp.json');
      if (existsSync(mcpFile)) files.push(mcpFile);
    }
  }
  return files;
}

// ── Phase E: warn about unmapped host paths ────────────────────────
function phaseE({ agentConfigDir, home, warn }) {
  for (const rel of WARN_TARGETS) {
    const file = join(agentConfigDir, rel);
    if (!existsSync(file)) continue;
    const hit = firstUnmappedHomePath(readFileSync(file, 'utf-8'), home);
    if (hit) {
      warn(`  Warning: host path in ${basename(file)} not covered by any mount:`);
      warn(`    ${hit}`);
      warn("    Add the appropriate 'ro' (or 'rw') mount to make it reachable from the container.");
    }
  }
}
