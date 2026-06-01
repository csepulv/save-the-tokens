// Ported from tools/hermes/lib/__tests__/config.test.js (M3a copy phase).
// loadConfig tests adapted to sync (agent-isolation is all-sync).
import { test, expect } from 'vitest';
import os from 'node:os';
import { validateConfig, loadConfig } from '../config.js';

const HOME = os.homedir();

const fullRaw = {
  container_name: 'hermes-personal',
  hermes_workspace: '~/workspace/hermes',
  launch_on_boot: false,
  ports: { gateway: 8642, dashboard: 9119, ssh: 2222 },
  ssh: { enabled: true, password: 'secret', authorized_key: '~/.ssh/id_ed25519.pub' },
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  mounts: [
    { host: '~/workspace/proj', mode: 'rw' },
    { host: '~/docs', mode: 'ro', target: 'design' },
    { host: '~/srv', mode: 'rw', target: '/srv/app' },
  ],
};

test('validateConfig normalizes a full config', () => {
  const c = validateConfig(fullRaw);
  expect(c.containerName).toBe('hermes-personal');
  expect(c.hermesWorkspace).toBe(`${HOME}/workspace/hermes`);
  expect(c.launchOnBoot).toBe(false);
  expect(c.ports).toEqual({ gateway: 8642, dashboard: 9119, ssh: 2222 });
  expect(c.ssh).toEqual({ enabled: true, password: 'secret', authorizedKey: `${HOME}/.ssh/id_ed25519.pub` });
  expect(c.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test' });
  expect(c.mounts).toEqual([
    { host: `${HOME}/workspace/proj`, mode: 'rw', containerPath: '/workspace/proj' },
    { host: `${HOME}/docs`, mode: 'ro', containerPath: '/reference/design' },
    { host: `${HOME}/srv`, mode: 'rw', containerPath: '/srv/app' },
  ]);
});

test('validateConfig applies defaults for a minimal config', () => {
  const c = validateConfig({ container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { password: 'p' } });
  expect(c.launchOnBoot).toBe(true);
  expect(c.ssh.enabled).toBe(true);
  expect(c.ports).toEqual({});
  expect(c.env).toEqual({});
  expect(c.mounts).toEqual([]);
});

test('ssh can be disabled without auth', () => {
  const c = validateConfig({ container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { enabled: false } });
  expect(c.ssh.enabled).toBe(false);
});

test('rejects a missing container_name', () => {
  expect(() => validateConfig({ hermes_workspace: '/tmp/ws', ssh: { password: 'p' } })).toThrow(/container_name/);
});

test('rejects a missing hermes_workspace', () => {
  expect(() => validateConfig({ container_name: 'h', ssh: { password: 'p' } })).toThrow(/hermes_workspace/);
});

test('rejects ssh enabled (default) with no password or key', () => {
  expect(() => validateConfig({ container_name: 'h', hermes_workspace: '/tmp/ws' })).toThrow(/ssh/);
});

test('rejects an invalid mount mode', () => {
  expect(() => validateConfig({
    container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { password: 'p' },
    mounts: [{ host: '~/x', mode: 'rwx' }],
  })).toThrow(/mode/);
});

test('rejects an absolute mount target under /opt/data', () => {
  expect(() => validateConfig({
    container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { password: 'p' },
    mounts: [{ host: '~/x', mode: 'rw', target: '/opt/data/sneaky' }],
  })).toThrow(/opt\/data/);
});

test('rejects a port out of range', () => {
  expect(() => validateConfig({
    container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { password: 'p' }, ports: { gateway: 99999 },
  })).toThrow(/port/);
});

test('rejects empty or non-mapping input', () => {
  expect(() => validateConfig(null)).toThrow();
  expect(() => validateConfig('nope')).toThrow();
});

test('loadConfig reads and parses a file via injected (sync) readFile', () => {
  const yamlText = ['container_name: from-file', 'hermes_workspace: /tmp/ws', 'ssh:', '  password: p'].join('\n');
  const c = loadConfig('/fake/config.yaml', { readFile: () => yamlText });
  expect(c.containerName).toBe('from-file');
});

test('loadConfig gives a clear error when the file is missing', () => {
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  expect(() => loadConfig('/missing.yaml', { readFile: () => { throw enoent; } })).toThrow(/not found/);
});

// ── per-container image extension (`build:`) ──────────────────────────
const minimal = { container_name: 'h', hermes_workspace: '/tmp/ws', ssh: { password: 'p' } };

test('normalizes a build block: dockerfile ~-expanded, args stringified', () => {
  const c = validateConfig({
    ...minimal,
    build: { dockerfile: '~/proj/docker/Dockerfile', args: { DUCKDB_ARCH: 'aarch64', DUCKDB_VERSION: 1.3 } },
  });
  expect(c.build).toEqual({
    dockerfile: `${HOME}/proj/docker/Dockerfile`,
    args: { DUCKDB_ARCH: 'aarch64', DUCKDB_VERSION: '1.3' },
  });
});

test('build with an explicit context (also ~-expanded)', () => {
  const c = validateConfig({ ...minimal, build: { dockerfile: '~/p/docker/Dockerfile', context: '~/p' } });
  expect(c.build).toEqual({ dockerfile: `${HOME}/p/docker/Dockerfile`, context: `${HOME}/p` });
});

test('no build field → config.build is undefined', () => {
  expect(validateConfig(minimal).build).toBeUndefined();
});

test('rejects a non-mapping build', () => {
  expect(() => validateConfig({ ...minimal, build: 'nope' })).toThrow(/build/);
});

test('rejects a build with no dockerfile', () => {
  expect(() => validateConfig({ ...minimal, build: { args: {} } })).toThrow(/dockerfile/);
});

test('rejects a build with a non-mapping args', () => {
  expect(() => validateConfig({ ...minimal, build: { dockerfile: '~/d/Dockerfile', args: [1, 2] } })).toThrow(/args/);
});

test('resolves a relative build.dockerfile against the config dir (baseDir)', () => {
  const c = validateConfig({ ...minimal, build: { dockerfile: './Dockerfile' } }, '/base/agent-iso');
  expect(c.build.dockerfile).toBe('/base/agent-iso/Dockerfile');
});

test('resolves ../ build paths against the config dir', () => {
  const c = validateConfig(
    { ...minimal, build: { dockerfile: '../docker/Dockerfile', context: '../docker' } },
    '/base/agent-iso',
  );
  expect(c.build).toEqual({ dockerfile: '/base/docker/Dockerfile', context: '/base/docker' });
});

// ── M3d: env_file ──
test('env_file resolves config-relative and must exist', () => {
  const c = validateConfig({ ...minimal, env_file: './secrets.env' }, '/base', { realpath: (p) => p });
  expect(c.envFile).toBe('/base/secrets.env');
});

test('a missing env_file errors clearly', () => {
  const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
  expect(() => validateConfig(
    { ...minimal, env_file: './nope.env' }, '/base', { realpath: () => { throw enoent; } },
  )).toThrow(/env_file not found/i);
});

test('no env_file → config.envFile undefined', () => {
  expect(validateConfig(minimal).envFile).toBeUndefined();
});

// ── M3d: path convergence — mounts/ssh/workspace via resolveConfigPath ──
test('a relative mount resolves against the config dir (canonicalize)', () => {
  const c = validateConfig(
    { ...minimal, mounts: [{ host: './data', mode: 'rw' }] },
    '/base/cfg', { realpath: (p) => p },
  );
  expect(c.mounts[0].host).toBe('/base/cfg/data');
  expect(c.mounts[0].containerPath).toBe('/workspace/data');
});

test('a relative mount whose source is missing errors clearly', () => {
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  expect(() => validateConfig(
    { ...minimal, mounts: [{ host: './missing', mode: 'rw' }] },
    '/base/cfg', { realpath: () => { throw enoent; } },
  )).toThrow(/not found/i);
});

test('absolute / ~ mounts pass through without an existence check', () => {
  const c = validateConfig(
    { ...minimal, mounts: [{ host: '~/abs/proj', mode: 'rw' }] },
    '/base', { realpath: () => { throw new Error('realpath should not be called for absolute'); } },
  );
  expect(c.mounts[0].host).toBe(`${HOME}/abs/proj`);
});

test('hermes_workspace resolves config-relative WITHOUT an existence check (tool creates it)', () => {
  const c = validateConfig(
    { container_name: 'h', hermes_workspace: './ws', ssh: { password: 'p' } },
    '/base/cfg', { realpath: () => { throw new Error('workspace must not be existence-checked'); } },
  );
  expect(c.hermesWorkspace).toBe('/base/cfg/ws');
});

test('a relative ssh.authorized_key resolves against the config dir', () => {
  const c = validateConfig(
    { ...minimal, ssh: { password: 'p', authorized_key: './id.pub' } },
    '/base/cfg', { realpath: (p) => p },
  );
  expect(c.ssh.authorizedKey).toBe('/base/cfg/id.pub');
});

test('loadConfig resolves relative build paths against the config file dir', () => {
  const yamlText = [
    'container_name: h', 'hermes_workspace: /tmp/ws', 'ssh: { password: p }',
    'build:', '  dockerfile: ./Dockerfile',
  ].join('\n');
  const c = loadConfig('/cfg/here/x.agent.yml', { readFile: () => yamlText });
  expect(c.build.dockerfile).toBe('/cfg/here/Dockerfile');
});
