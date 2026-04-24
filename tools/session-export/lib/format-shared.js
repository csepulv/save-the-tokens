import prettyMs from 'pretty-ms';

/**
 * Normalize formatter options — apply the "includeAll implies everything"
 * rule once, so both formatters share the same view of what's effectively
 * enabled. Returns a frozen-shape object with all flags resolved.
 */
export function normalizeFormatOptions(options = {}) {
  const {
    includeTools = false,
    includeSystem = false,
    includeAll = false,
    includeTimestamps = false,
    includeSkillText = false,
  } = options;

  return {
    includeTools: includeTools || includeAll,
    includeSystem: includeSystem || includeAll,
    includeAll,
    includeTimestamps: includeTimestamps || includeAll,
    includeSkillText,
  };
}

const FRONTMATTER_FIELDS = [
  ['session', 'sessionId'],
  ['title', 'customTitle'],
  ['project', 'project'],
  ['cwd', 'cwd'],
  ['hostname', 'hostname'],
  ['git_branch', 'gitBranch'],
  ['claude_version', 'claudeVersion'],
  ['permission_mode', 'permissionMode'],
  ['started_at', 'startedAt'],
  ['ended_at', 'endedAt'],
  ['exported_at', 'exportDate'],
  ['source', 'sourcePath'],
];

const INCLUDE_FIELDS = [
  ['include_tools', 'includeTools'],
  ['include_system', 'includeSystem'],
  ['include_all', 'includeAll'],
  ['include_timestamps', 'includeTimestamps'],
];

function computeDuration(metadata) {
  const { startedAt, endedAt } = metadata;
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt) - new Date(startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return prettyMs(ms, { secondsDecimalDigits: 0, compact: false });
}

export function buildFrontmatter(metadata, formatOptions = {}) {
  const lines = ['---'];

  for (const [key, prop] of FRONTMATTER_FIELDS) {
    const value = metadata[prop];
    if (value != null) lines.push(`${key}: ${value}`);
  }

  const duration = computeDuration(metadata);
  if (duration) lines.push(`duration: ${duration}`);

  for (const [key, prop] of INCLUDE_FIELDS) {
    if (formatOptions[prop]) lines.push(`${key}: true`);
  }

  lines.push('---');
  return lines.join('\n');
}
