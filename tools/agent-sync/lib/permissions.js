import fs from 'fs/promises';
import path from 'path';

import {
  getClaudeConfigDir,
  getSkillsDirectory,
  loadPermissionsState,
  savePermissionsState
} from './config.js';
import { loadJsonState, saveJsonState } from './io.js';
import { parseFrontmatter } from './sync.js';

/**
 * Collect Claude Code permission entries for a set of skills.
 *
 * For each skill: one `Skill(<name>)` entry, plus every entry from that
 * skill's SKILL.md `allowed-tools` frontmatter (the Bash-cascade — allowing
 * a skill does not cascade to the tools it runs).
 *
 * @param {string} skillsDir - config-directory/skills path
 * @param {string[]} skillNames - Skill directory names to collect for
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<string[]>} Deduplicated permission strings
 */
export async function collectSkillPermissions(skillsDir, skillNames, deps = {}) {
  const { readFile = fs.readFile } = deps;
  const permissions = [];

  for (const name of skillNames) {
    permissions.push(`Skill(${name})`);

    let content;
    try {
      content = await readFile(path.join(skillsDir, name, 'SKILL.md'), 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    const { frontmatter } = parseFrontmatter(content);
    const allowedTools = frontmatter['allowed-tools'];
    if (Array.isArray(allowedTools)) {
      for (const tool of allowedTools) {
        if (typeof tool === 'string') permissions.push(tool);
      }
    }
  }

  return [...new Set(permissions)];
}

/**
 * Merge wanted permission entries into a settings.json object.
 *
 * Pure function. Additive: wanted entries are appended to
 * `permissions.allow` (deduplicated); every other field of `settings` is
 * preserved. When `options.clean` is set, entries that agent-sync
 * previously placed (`previouslyAdded`) but no longer wants are removed —
 * entries the user added by hand are never touched.
 *
 * @param {object} settings - Existing settings.json object (may be empty)
 * @param {string[]} wanted - Permission entries that should be present
 * @param {string[]} [previouslyAdded] - Entries agent-sync placed last run
 * @param {object} [options] - { clean }
 * @returns {{ settings: object, added: string[], removed: string[] }}
 */
export function mergeSkillPermissions(settings, wanted, previouslyAdded = [], options = {}) {
  const base = settings || {};
  const permissions = { ...(base.permissions || {}) };
  const existingAllow = Array.isArray(permissions.allow) ? permissions.allow : [];

  const wantedSet = new Set(wanted);
  const previousSet = new Set(previouslyAdded);

  const added = [];
  const removed = [];

  let allow = existingAllow;
  if (options.clean) {
    allow = allow.filter((entry) => {
      const isOrphan = previousSet.has(entry) && !wantedSet.has(entry);
      if (isOrphan) removed.push(entry);
      return !isOrphan;
    });
  }

  const allowSet = new Set(allow);
  const nextAllow = [...allow];
  for (const entry of wanted) {
    if (!allowSet.has(entry)) {
      allowSet.add(entry);
      nextAllow.push(entry);
      added.push(entry);
    }
  }

  return {
    settings: { ...base, permissions: { ...permissions, allow: nextAllow } },
    added,
    removed
  };
}

/**
 * Sync skill permissions into a claude-code target's settings.json.
 *
 * Resolves <configDir>/settings.json for the target, merges in
 * `Skill(...)` + `allowed-tools` entries for the given skills, and writes
 * the file back. Tracks what it placed in permissions-state.json so a
 * later `--clean` run can prune orphans.
 *
 * @param {object} config - Config object
 * @param {string} targetName - Target key (e.g. "claude-code", "claude-code:work")
 * @param {string[]} skillNames - Skill directory names to grant
 * @param {object} [options] - { clean, dryRun }
 * @param {object} [deps] - Optional dependencies for testing
 * @returns {Promise<{settingsPath, added, removed}|null>} null for non-claude-code targets
 */
export async function syncSkillPermissions(config, targetName, skillNames, options = {}, deps = {}) {
  const {
    getClaudeConfigDir: getConfigDir = getClaudeConfigDir,
    getSkillsDirectory: getSkillsDir = getSkillsDirectory,
    collectSkillPermissions: collect = collectSkillPermissions,
    loadPermissionsState: loadState = loadPermissionsState,
    savePermissionsState: saveState = savePermissionsState,
    readFile = fs.readFile,
    writeFile = fs.writeFile
  } = deps;

  const configDir = getConfigDir(targetName, config);
  if (!configDir) return null;

  const settingsPath = path.join(configDir, 'settings.json');

  const wanted = await collect(getSkillsDir(config), skillNames, deps);
  const state = await loadState(config, deps);
  const previouslyAdded = state[targetName] || [];

  const settings = await loadJsonState(settingsPath, { readFile });
  const result = mergeSkillPermissions(settings, wanted, previouslyAdded, options);

  if (!options.dryRun) {
    await saveJsonState(settingsPath, result.settings, { writeFile });
    state[targetName] = wanted;
    await saveState(config, state, deps);
  }

  return { settingsPath, added: result.added, removed: result.removed };
}
