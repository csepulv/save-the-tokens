// sync/mcp-inject.js — Phase D: inject MCP servers for enabled plugins.
//
// Plugin .mcp.json files come in two shapes: wrapped ({"mcpServers": {…}},
// discord-style) or wrapperless ({"name": …}, context7/github/etc.).
// unwrapMcp normalizes both. Selection: enabled plugins from settings
// (names stripped of @version) plus a hardcoded EXTRA_PLUGINS set whose
// members are enabled via __store.db (excluded from the sync).

const EXTRA_PLUGINS = ['slack'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// jq `*` semantics: recursively merge objects; for non-objects, right wins.
export function deepMerge(a, b) {
  if (isPlainObject(a) && isPlainObject(b)) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b)) {
      out[key] = key in a ? deepMerge(a[key], value) : value;
    }
    return out;
  }
  return b;
}

export const unwrapMcp = (parsed) => parsed.mcpServers ?? parsed;

export function selectedPluginNames(settings, extra = EXTRA_PLUGINS) {
  const names = new Set(extra);
  for (const key of Object.keys(settings.enabledPlugins || {})) {
    names.add(key.split('@')[0]);
  }
  return names;
}

// Merge the selected plugins' MCP server maps into settings.mcpServers.
// parsedMcpList is the already-filtered list of parsed .mcp.json objects.
export function injectMcp(settings, parsedMcpList, { headless = false } = {}) {
  const injected = parsedMcpList.reduce((acc, parsed) => deepMerge(acc, unwrapMcp(parsed)), {});
  const out = { ...settings, mcpServers: deepMerge(settings.mcpServers || {}, injected) };
  if (headless) delete out.statusLine;
  return out;
}
