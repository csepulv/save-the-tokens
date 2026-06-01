// daemon/claude-seed.js — One-time seed of a daemon container's Claude Code
// config from the host's ~/.claude. Idempotent (skipped when the target has
// content). Ephemeral/session data excluded; mcpServers are STRIPPED (host
// MCP servers won't resolve inside the nested-worker container — the daemon
// counterpart to the interactive sync's MCP *injection*).
//
// Copied from tools/hermes/lib/claude-seed.js (M3a), sync.

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ALWAYS_EXCLUDE, SESSION_EXCLUDE } from '../claude-excludes.js';

// Ephemeral / session-specific data excluded from the copy. Shared lists with
// the interactive `sync` (claude-excludes.js); the daemon seed always drops
// sessions (no --include-all).
const RSYNC_EXCLUDES = [...ALWAYS_EXCLUDE, ...SESSION_EXCLUDE];

// Dirs Claude Code expects to exist (excluded from the copy above).
const ENSURE_DIRS = ['projects', 'sessions', 'backups', 'plans', 'tasks', 'todos', 'cache'];

// Settings files to strip `mcpServers` from after the copy.
const MCP_FILES = ['settings.json', '.claude.json'];

function defaultRunRsync(src, dest, excludes) {
  const args = ['-a', ...excludes.flatMap((e) => ['--exclude', e]), `${src}/`, `${dest}/`];
  execFileSync('rsync', args);
}

function stripMcpServers(filePath, { readFile, writeFile }) {
  let text;
  try {
    text = readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  const data = JSON.parse(text);
  if (data.mcpServers === undefined) return false;
  delete data.mcpServers;
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

export function seedClaudeConfig(claudeDir, deps = {}) {
  const {
    sourceClaudeDir = `${os.homedir()}/.claude`,
    readdir = (p) => readdirSync(p),
    readFile = (p) => readFileSync(p, 'utf-8'),
    writeFile = (p, c) => writeFileSync(p, c),
    copyFile = (s, d) => copyFileSync(s, d),
    mkdir = (p, opts) => mkdirSync(p, opts),
    runRsync = defaultRunRsync,
  } = deps;

  let existing;
  try { existing = readdir(claudeDir); } catch { existing = []; }
  if (existing.length > 0) {
    return { seeded: false, reason: 'claude config dir already populated' };
  }

  let source;
  try { source = readdir(sourceClaudeDir); } catch { source = null; }
  if (source === null) {
    return { seeded: false, reason: `no ${sourceClaudeDir} to copy` };
  }

  runRsync(sourceClaudeDir, claudeDir, RSYNC_EXCLUDES);

  try {
    copyFile(`${sourceClaudeDir}/.credentials.json`, `${claudeDir}/.credentials.json`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  for (const file of MCP_FILES) {
    stripMcpServers(`${claudeDir}/${file}`, { readFile, writeFile });
  }
  for (const dir of ENSURE_DIRS) {
    mkdir(`${claudeDir}/${dir}`, { recursive: true });
  }

  return { seeded: true };
}
