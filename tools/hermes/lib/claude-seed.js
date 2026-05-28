// One-time seed of a container's Claude Code config from the host's ~/.claude.
// Skipped when the target already has content (idempotent). Ephemeral/session
// data is excluded; mcpServers are stripped (host MCP servers won't resolve
// inside the container).

import {
  readdir as fsReaddir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  copyFile as fsCopyFile,
  mkdir as fsMkdir,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// Ephemeral / session-specific data excluded from the copy.
const RSYNC_EXCLUDES = [
  '__store.db', 'debug/', 'history.jsonl', 'shell-snapshots/', 'session-env/',
  'telemetry/', 'statsig/', 'stats-cache.json', 'security_warnings_state_*.json',
  'ide/', 'downloads/', 'paste-cache/', 'file-history/', '.DS_Store',
  '.credentials.json', 'projects/', 'sessions/', 'plans/', 'tasks/', 'todos/',
  'usage-data/', 'cache/', 'backups/',
];

// Dirs Claude Code expects to exist (excluded from the copy above).
const ENSURE_DIRS = ['projects', 'sessions', 'backups', 'plans', 'tasks', 'todos', 'cache'];

// Settings files to strip `mcpServers` from after the copy.
const MCP_FILES = ['settings.json', '.claude.json'];

async function defaultRunRsync(src, dest, excludes) {
  const args = ['-a', ...excludes.flatMap((e) => ['--exclude', e]), `${src}/`, `${dest}/`];
  await execFileAsync('rsync', args);
}

async function stripMcpServers(filePath, { readFile, writeFile }) {
  let text;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  const data = JSON.parse(text);
  if (data.mcpServers === undefined) return false;
  delete data.mcpServers;
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

export async function seedClaudeConfig(claudeDir, deps = {}) {
  const {
    sourceClaudeDir = `${os.homedir()}/.claude`,
    readdir = fsReaddir,
    readFile = fsReadFile,
    writeFile = fsWriteFile,
    copyFile = fsCopyFile,
    mkdir = fsMkdir,
    runRsync = defaultRunRsync,
  } = deps;

  const existing = await readdir(claudeDir).catch(() => []);
  if (existing.length > 0) {
    return { seeded: false, reason: 'claude config dir already populated' };
  }

  const source = await readdir(sourceClaudeDir).catch(() => null);
  if (source === null) {
    return { seeded: false, reason: `no ${sourceClaudeDir} to copy` };
  }

  await runRsync(sourceClaudeDir, claudeDir, RSYNC_EXCLUDES);

  await copyFile(`${sourceClaudeDir}/.credentials.json`, `${claudeDir}/.credentials.json`)
    .catch((err) => { if (err.code !== 'ENOENT') throw err; });

  for (const file of MCP_FILES) {
    await stripMcpServers(`${claudeDir}/${file}`, { readFile, writeFile });
  }

  for (const dir of ENSURE_DIRS) {
    await mkdir(`${claudeDir}/${dir}`, { recursive: true });
  }

  return { seeded: true };
}
