// constants.js — Shared constants (port of config.sh's top-level vars).

export const IMAGE_NAME = 'claude-agent';

// Daemon image is date-tagged (yyyymmdd), not :latest — `:latest` is a moving
// target (the base drift that bit M3b). Bump deliberately when rebuilding — on a
// newer pinned base, OR with new baked tooling (e.g. the chromium + agent-browser
// layer added 20260603). Both `build daemon` and the emitted compose use this ref,
// so they always agree. The dated tag already separates this from any standalone
// `hermes-claude:latest` deployment (so no rename is needed — name says what it
// is: the Hermes + Claude image).
export const DAEMON_IMAGE_NAME = 'hermes-claude';
export const DAEMON_IMAGE_TAG = '20260603';
export const DAEMON_IMAGE_REF = `${DAEMON_IMAGE_NAME}:${DAEMON_IMAGE_TAG}`;
export const CONTAINER_PREFIX = 'agent';
export const AGENT_USER = 'agent';
export const AGENT_HOME = '/home/agent';
export const SLACK_OAUTH_PORT = 3118;

export const WORKSPACE_MOUNT = '/workspace';
export const REFERENCE_MOUNT = '/reference';
export const MCP_MOUNT = '/mcp';

export const CLAUDE_CONTAINER_PATH = `${AGENT_HOME}/.claude`;
export const STATE_CONTAINER_PATH = `${AGENT_HOME}/.agent-isolation`;
