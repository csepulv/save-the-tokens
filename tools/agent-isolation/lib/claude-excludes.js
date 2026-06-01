// claude-excludes.js — rsync exclude lists for copying the host's ~/.claude into
// a container's config dir. Shared (M3d) by the interactive `sync`
// (commands/sync.js) and the daemon `claude-seed` (daemon/claude-seed.js).
//
// Each consumer composes its own effective set:
//   - interactive sync:  [...ALWAYS_EXCLUDE, '/settings.json'] always (settings is
//                        composed separately), + SESSION_EXCLUDE unless --include-all
//   - daemon claude-seed: [...ALWAYS_EXCLUDE, ...SESSION_EXCLUDE] always (sessions
//                        never cross; settings.json IS copied, then mcp-stripped)

// Host-specific, ephemeral, or secret-shaped state that must never cross.
export const ALWAYS_EXCLUDE = [
  '__store.db', 'debug/', 'history.jsonl', 'shell-snapshots/', 'session-env/',
  'telemetry/', 'statsig/', 'stats-cache.json', 'security_warnings_state_*.json',
  'ide/', 'downloads/', 'paste-cache/', 'file-history/', '.DS_Store',
  '.credentials.json',
];

// Session / working data — dropped by default; kept by interactive
// `sync --include-all`, always dropped by the daemon seed.
export const SESSION_EXCLUDE = [
  'projects/', 'sessions/', 'plans/', 'tasks/', 'todos/', 'usage-data/', 'cache/', 'backups/',
];
