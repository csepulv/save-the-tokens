// sync/settings.js — Phase B: compose the container settings.json.
//
// The host settings.json is NOT rsynced (host is protective; container is
// broadly permissive — different stance). Compose from a container template
// plus a whitelist of host fields. permissions and hooks are intentionally
// excluded: the template carries the container stance, and host hooks (e.g.
// junkdrawer) can't run inside the container. Phase D injects MCP on top.

export const SETTINGS_WHITELIST = [
  'enabledPlugins',
  'extraKnownMarketplaces',
  'statusLine',
  'voice',
  'voiceEnabled',
  'agentPushNotifEnabled',
  'effortLevel',
  'skillListingBudgetFraction',
  'env',
];

export function composeSettings(template, hostSettings) {
  if (!hostSettings) return { ...template };
  const overlay = {};
  for (const key of SETTINGS_WHITELIST) {
    if (key in hostSettings) overlay[key] = hostSettings[key];
  }
  return { ...template, ...overlay };
}
