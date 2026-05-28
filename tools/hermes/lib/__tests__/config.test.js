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
  expect(c.ssh).toEqual({
    enabled: true,
    password: 'secret',
    authorizedKey: `${HOME}/.ssh/id_ed25519.pub`,
  });
  expect(c.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test' });
  expect(c.mounts).toEqual([
    { host: `${HOME}/workspace/proj`, mode: 'rw', containerPath: '/workspace/proj' },
    { host: `${HOME}/docs`, mode: 'ro', containerPath: '/reference/design' },
    { host: `${HOME}/srv`, mode: 'rw', containerPath: '/srv/app' },
  ]);
});

test('validateConfig applies defaults for a minimal config', () => {
  const c = validateConfig({
    container_name: 'h',
    hermes_workspace: '/tmp/ws',
    ssh: { password: 'p' },
  });
  expect(c.launchOnBoot).toBe(true);
  expect(c.ssh.enabled).toBe(true);
  expect(c.ports).toEqual({});
  expect(c.env).toEqual({});
  expect(c.mounts).toEqual([]);
});

test('ssh can be disabled without auth', () => {
  const c = validateConfig({
    container_name: 'h',
    hermes_workspace: '/tmp/ws',
    ssh: { enabled: false },
  });
  expect(c.ssh.enabled).toBe(false);
});

test('rejects a missing container_name', () => {
  expect(() => validateConfig({ hermes_workspace: '/tmp/ws', ssh: { password: 'p' } }))
    .toThrow(/container_name/);
});

test('rejects a missing hermes_workspace', () => {
  expect(() => validateConfig({ container_name: 'h', ssh: { password: 'p' } }))
    .toThrow(/hermes_workspace/);
});

test('rejects ssh enabled (default) with no password or key', () => {
  expect(() => validateConfig({ container_name: 'h', hermes_workspace: '/tmp/ws' }))
    .toThrow(/ssh/);
});

test('rejects an invalid mount mode', () => {
  expect(() => validateConfig({
    container_name: 'h',
    hermes_workspace: '/tmp/ws',
    ssh: { password: 'p' },
    mounts: [{ host: '~/x', mode: 'rwx' }],
  })).toThrow(/mode/);
});

test('rejects an absolute mount target under /opt/data', () => {
  expect(() => validateConfig({
    container_name: 'h',
    hermes_workspace: '/tmp/ws',
    ssh: { password: 'p' },
    mounts: [{ host: '~/x', mode: 'rw', target: '/opt/data/sneaky' }],
  })).toThrow(/opt\/data/);
});

test('rejects a port out of range', () => {
  expect(() => validateConfig({
    container_name: 'h',
    hermes_workspace: '/tmp/ws',
    ssh: { password: 'p' },
    ports: { gateway: 99999 },
  })).toThrow(/port/);
});

test('rejects empty or non-mapping input', () => {
  expect(() => validateConfig(null)).toThrow();
  expect(() => validateConfig('nope')).toThrow();
});

test('loadConfig reads and parses a file via injected readFile', async () => {
  const yamlText = [
    'container_name: from-file',
    'hermes_workspace: /tmp/ws',
    'ssh:',
    '  password: p',
  ].join('\n');
  const c = await loadConfig('/fake/config.yaml', { readFile: async () => yamlText });
  expect(c.containerName).toBe('from-file');
});

test('loadConfig gives a clear error when the file is missing', async () => {
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  await expect(
    loadConfig('/missing.yaml', { readFile: async () => { throw enoent; } }),
  ).rejects.toThrow(/not found/);
});
