// Differential test (M1-S2): the bash sync-config.sh is the oracle.
// Run the Node sync and the bash sync against the same fixture ~/.claude
// and assert the resulting config trees are semantically equal.

import { test, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncConfig } from '../sync.js';

const TOOL_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const HOME = process.env.HOME || homedir();

let root, hostClaude, targetNode, targetBash, mcpHost, roHost, cfgNode, cfgBash;

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-sync-'));
  hostClaude = join(root, 'host-claude');
  targetNode = join(root, 'agent-claude-node');
  targetBash = join(root, 'agent-claude-bash');
  mcpHost = join(root, 'mcp-src');
  roHost = join(root, 'ref-src');
  mkdirSync(mcpHost, { recursive: true });
  mkdirSync(roHost, { recursive: true });

  // ── Fixture host ~/.claude ──
  writeJson(join(hostClaude, 'settings.json'), {
    enabledPlugins: { 'discord@1.0': true, 'context7@2.0': true },
    extraKnownMarketplaces: { mkt: { source: 'x' } },
    statusLine: { type: 'command', command: 'sl' },
    effortLevel: 'high',
    env: { A: '1' },
    permissions: { allow: ['Bash(sudo:*)'] }, // NOT whitelisted
    hooks: { SessionEnd: [] }, // NOT whitelisted
  });
  writeJson(join(hostClaude, '.claude.json'), {
    mcpServers: { local: { command: 'node', args: [`${mcpHost}/server.js`] } },
    recentDir: `${hostClaude}/projects/x`,
  });
  writeJson(join(hostClaude, 'plugins', 'installed_plugins.json'), {
    repos: { foo: { installPath: `${hostClaude}/plugins/foo` } },
    ref: `${roHost}/thing`,
  });
  writeJson(join(hostClaude, 'plugins', 'known_marketplaces.json'), {
    mkt: { path: `${hostClaude}/plugins/marketplaces/mkt` },
  });
  // Plugin .mcp.json in both shapes
  writeJson(join(hostClaude, 'plugins/marketplaces/mkt/external_plugins/discord/.mcp.json'),
    { mcpServers: { discord: { command: 'discord-cli' } } }); // wrapped
  writeJson(join(hostClaude, 'plugins/marketplaces/mkt/external_plugins/context7/.mcp.json'),
    { context7: { command: 'ctx' } }); // wrapperless
  mkdirSync(join(hostClaude, 'projects'), { recursive: true }); // excluded by sync

  const mounts = (claudeTarget) => `mounts:
  - { host: ${claudeTarget}, mode: claude }
  - { host: ${roHost}, mode: ro }
  - { host: ${mcpHost}, mode: mcp }
`;
  cfgNode = join(root, 'node.agent.yml');
  cfgBash = join(root, 'bash.agent.yml');
  writeFileSync(cfgNode, mounts(targetNode));
  writeFileSync(cfgBash, mounts(targetBash));

  // ── Run Node sync (silent) ──
  syncConfig({ configArg: cfgNode, sourceDir: hostClaude }, { log: () => {}, warn: () => {}, home: HOME });

  // ── Run bash sync (the oracle) ──
  execFileSync('bash', [join(TOOL_DIR, 'sync-config.sh'), '--config', cfgBash, '--source', hostClaude],
    { stdio: 'pipe' });
});

const bothJson = (rel) => [
  JSON.parse(readFileSync(join(targetNode, rel), 'utf-8')),
  JSON.parse(readFileSync(join(targetBash, rel), 'utf-8')),
];

test('settings.json matches the bash oracle (whitelist + MCP inject)', () => {
  const [node, bash] = bothJson('settings.json');
  expect(node).toEqual(bash);
  // sanity: the transform actually did its job
  expect(node.permissions).toEqual({ allow: [], deny: ['Bash(rm -rf:*)'] }); // template stance, host excluded
  expect(node.hooks).toBeUndefined();
  expect(node.mcpServers).toEqual({
    discord: { command: 'discord-cli' },
    context7: { command: 'ctx' },
  });
});

test('.claude.json matches the bash oracle (path rewrite)', () => {
  const [node, bash] = bothJson('.claude.json');
  expect(node).toEqual(bash);
  expect(node.mcpServers.local.args[0]).toBe('/mcp/mcp-src/server.js');
  expect(node.recentDir).toBe('/home/agent/.claude/projects/x');
});

test('installed_plugins.json matches the bash oracle (HOST_CLAUDE + ro rewrite)', () => {
  const [node, bash] = bothJson('plugins/installed_plugins.json');
  expect(node).toEqual(bash);
  expect(node.repos.foo.installPath).toBe('/home/agent/.claude/plugins/foo');
  expect(node.ref).toBe('/reference/ref-src/thing');
});

test('known_marketplaces.json matches the bash oracle', () => {
  const [node, bash] = bothJson('plugins/known_marketplaces.json');
  expect(node).toEqual(bash);
});

test('both runs exclude session dirs but seed the write dirs', () => {
  // projects/ excluded from content but recreated empty for container writes
  expect(existsSync(join(targetNode, 'projects'))).toBe(true);
  expect(existsSync(join(targetNode, 'rules', 'local-additional-context.md'))).toBe(true);
});
