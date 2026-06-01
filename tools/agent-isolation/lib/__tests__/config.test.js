import { test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConfig, defaultContainerNameFromConfig, resolveConfigFile, readConfigMode } from '../config.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HOME = '/Users/test';

test('resolves relative mount hosts against the config file dir, not cwd', () => {
  // realpath stubbed to identity so we can assert the resolution base.
  const cfg = parseConfig(join(FIXTURES, 'relmount.agent.yml'), { home: HOME, realpath: (p) => p });
  const rw = cfg.mounts.find((m) => m.mode === 'rw');
  const ro = cfg.mounts.find((m) => m.mode === 'ro');
  expect(rw.host).toBe(join(FIXTURES, 'proj')); // ./proj relative to config dir
  expect(ro.host).toBe(join(dirname(FIXTURES), 'sibling')); // ../sibling relative to config dir
});

test('resolves env_file against the config file dir', () => {
  const cfg = parseConfig(join(FIXTURES, 'envfile.agent.yml'), { home: HOME, realpath: (p) => p });
  expect(cfg.envFile).toBe(join(FIXTURES, 'secret.env'));
});

const parse = (name) => parseConfig(join(FIXTURES, name), { home: HOME });

test('parses the full config surface', () => {
  const cfg = parse('full.agent.yml');

  expect(cfg.containerName).toBe('agent-tsugi');
  expect(cfg.hostnameOverride).toBe('tsugi-dev');
  expect(cfg.servicesFile).toBe('my-project.services.compose.yml');
  expect(cfg.network).toBe('');
  expect(cfg.settingsTemplate).toBe('');
});

test('resolves mounts to container paths with ~ expansion', () => {
  const cfg = parse('full.agent.yml');

  expect(cfg.mounts).toEqual([
    { host: `${HOME}/agent-workspace/agent-claude`, mode: 'claude', containerPath: '/home/agent/.claude', name: 'claude' },
    { host: `${HOME}/workspace/my-project`, mode: 'rw', containerPath: '/workspace/my-project', name: 'my-project' },
    { host: `${HOME}/workspace/stt-private`, mode: 'ro', containerPath: '/reference/stt-private', name: 'stt-private' },
    { host: `${HOME}/some-mcp-source`, mode: 'mcp', containerPath: '/mcp/my-mcp', name: 'my-mcp' },
  ]);
});

test('derives claudeDir, firstRw, and rw/ro/mcp volume mounts (mcp→ro, claude excluded)', () => {
  const cfg = parse('full.agent.yml');

  expect(cfg.claudeDir).toBe(`${HOME}/agent-workspace/agent-claude`);
  expect(cfg.firstRw).toEqual({ name: 'my-project', containerPath: '/workspace/my-project' });
  expect(cfg.volumeMounts).toEqual([
    { host: `${HOME}/workspace/my-project`, containerPath: '/workspace/my-project', dockerMode: 'rw' },
    { host: `${HOME}/workspace/stt-private`, containerPath: '/reference/stt-private', dockerMode: 'ro' },
    { host: `${HOME}/some-mcp-source`, containerPath: '/mcp/my-mcp', dockerMode: 'ro' },
  ]);
});

test('normalizes ports: bare number → host:container, string passthrough', () => {
  const cfg = parse('full.agent.yml');
  expect(cfg.ports).toEqual(['5173:5173', '27017:27017']);
});

test('parses env as KEY=value pairs preserving order', () => {
  const cfg = parse('full.agent.yml');
  expect(cfg.envPairs).toEqual([
    'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
    'PROJECT_API_HOST=http://elasticsearch:9200',
  ]);
});

test('parses on_start block verbatim', () => {
  const cfg = parse('full.agent.yml');
  expect(cfg.onStart).toEqual({
    command: 'node /reference/x/daemon.js',
    env: { CENTRAL_URL: 'http://host.docker.internal:4830' },
    log: '/tmp/daemon.log',
  });
});

test('derives container name from filename when container_name absent', () => {
  const cfg = parse('minimal.agent.yml');
  expect(cfg.containerName).toBe('agent-minimal');
  expect(cfg.hostnameOverride).toBe('');
  expect(cfg.ports).toEqual([]);
  expect(cfg.envPairs).toEqual([]);
  expect(cfg.onStart).toBeNull();
});

test('readConfigMode returns daemon for mode: daemon, interactive otherwise', () => {
  expect(readConfigMode(join(FIXTURES, 'daemon.agent.yml'))).toBe('daemon');
  expect(readConfigMode(join(FIXTURES, 'minimal.agent.yml'))).toBe('interactive');
});

test('defaultContainerNameFromConfig: <base>.agent.yml → agent-<base>', () => {
  expect(defaultContainerNameFromConfig('/x/tsugi.agent.yml')).toBe('agent-tsugi');
  expect(defaultContainerNameFromConfig('minimal.agent.yml')).toBe('agent-minimal');
});

test('throws on an invalid mount mode, naming the offender', () => {
  expect(() => parse('bad-mode.agent.yml')).toThrow(/bogus/);
});

// ── resolveConfigFile ──────────────────────────────────────────────
const resolveDeps = ({ cwdList = [], toolList = [], exists = true }) => ({
  cwd: '/cwd',
  toolDir: '/tool',
  fileExists: () => exists,
  listAgentConfigs: (dir) => (dir === '/cwd' ? cwdList : toolList),
});

test('resolveConfigFile returns an explicit path that exists', () => {
  expect(resolveConfigFile('/x/my.agent.yml', resolveDeps({ exists: true }))).toBe('/x/my.agent.yml');
});

test('resolveConfigFile throws when the explicit path is missing', () => {
  expect(() => resolveConfigFile('/x/missing.agent.yml', resolveDeps({ exists: false }))).toThrow(/not found/);
});

test('resolveConfigFile auto-detects a single config in cwd', () => {
  expect(resolveConfigFile('', resolveDeps({ cwdList: ['/cwd/a.agent.yml'] }))).toBe('/cwd/a.agent.yml');
});

test('resolveConfigFile errors when cwd is ambiguous', () => {
  expect(() => resolveConfigFile('', resolveDeps({ cwdList: ['/cwd/a.agent.yml', '/cwd/b.agent.yml'] }))).toThrow(/Multiple/);
});

test('resolveConfigFile falls back to the tool dir when cwd is empty', () => {
  expect(resolveConfigFile('', resolveDeps({ cwdList: [], toolList: ['/tool/t.agent.yml'] }))).toBe('/tool/t.agent.yml');
});

test('resolveConfigFile throws when nothing is found anywhere', () => {
  expect(() => resolveConfigFile('', resolveDeps({}))).toThrow(/No \*\.agent\.yml found/);
});
