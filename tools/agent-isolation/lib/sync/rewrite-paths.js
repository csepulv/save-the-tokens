// sync/rewrite-paths.js — Phase C: host→container path rewriting.
//
// Replaces sync-config.sh's jq `walk` filter with a native deep walk.
// Each mapping is { host, container }; a string value whose prefix matches
// a mapping's host has that prefix swapped for the container path. First
// matching mapping wins (mappings are ordered). Only string leaves are
// transformed — object keys and non-string scalars are left untouched,
// matching jq `walk` semantics.

export function rewriteString(str, mappings) {
  for (const { host, container } of mappings) {
    if (str.startsWith(host)) return container + str.slice(host.length);
  }
  return str;
}

export function rewritePaths(value, mappings) {
  if (typeof value === 'string') return rewriteString(value, mappings);
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, mappings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, rewritePaths(v, mappings)]),
    );
  }
  return value;
}

// Ordered host=container mappings for a sync.
//
// Always seeds HOST_CLAUDE → AGENT_HOME/.claude first: that's where the
// data was rsynced FROM, so references inside (e.g. installed_plugins.json's
// installPath) point at HOST_CLAUDE and must be rewritten. The `claude`
// mount names the bind-mount SOURCE (the rsync destination), not the
// origin — skip it.
export function buildMappings(hostClaude, mounts, agentHome) {
  const mappings = [{ host: hostClaude, container: `${agentHome}/.claude` }];
  for (const mount of mounts) {
    if (mount.mode === 'claude') continue;
    mappings.push({ host: mount.host, container: mount.containerPath });
  }
  return mappings;
}
