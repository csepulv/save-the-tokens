import { test, expect } from 'vitest';
import yaml from 'js-yaml';
import { run } from '../init-hermes-container.js';

const normalizedConfig = {
  containerName: 'c',
  hermesWorkspace: '/ws',
  launchOnBoot: true,
  ports: {},
  ssh: { enabled: false },
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  mounts: [{ host: '/h/proj', mode: 'rw', containerPath: '/workspace/proj' }],
};

function stubDeps(overrides = {}) {
  return {
    loadConfig: async () => normalizedConfig,
    ensureWorkspace: async () => ({ hermesDir: '/ws/hermes', claudeDir: '/ws/claude-code' }),
    seedClaudeConfig: async () => ({ seeded: true }),
    resolvePorts: async () => ({ gateway: 8642, dashboard: 9119 }),
    writeFile: async () => {},
    getUid: () => 501,
    getGid: () => 20,
    log: () => {},
    ...overrides,
  };
}

test('run orchestrates load → workspace → seed → ports → compose → write', async () => {
  const writes = [];
  const result = await run(['node', 'init', '/cfg.yaml'], stubDeps({
    writeFile: async (path, content) => writes.push({ path, content }),
  }));

  expect(result.composePath).toBe('/ws/docker-compose.yml');
  expect(result.ports).toEqual({ gateway: 8642, dashboard: 9119 });
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe('/ws/docker-compose.yml');

  const compose = yaml.load(writes[0].content);
  expect(compose.name).toBe('c');
  expect(Object.keys(compose.services)).toEqual(['gateway', 'dashboard']);
  expect(compose.services.gateway.environment.ANTHROPIC_API_KEY).toBe('sk-test');
});

test('run errors when no config path is given', async () => {
  await expect(run(['node', 'init'], stubDeps())).rejects.toThrow(/usage/);
});

test('run threads the seed result into the summary', async () => {
  const logs = [];
  await run(['node', 'init', '/cfg.yaml'], stubDeps({
    seedClaudeConfig: async () => ({ seeded: false, reason: 'already populated' }),
    log: (msg) => logs.push(msg),
  }));
  expect(logs.join('\n')).toMatch(/skipped \(already populated\)/);
});

test('run resolves the ssh port when ssh is enabled', async () => {
  let portKeys;
  await run(['node', 'init', '/cfg.yaml'], stubDeps({
    loadConfig: async () => ({ ...normalizedConfig, ssh: { enabled: true, password: 'p' } }),
    resolvePorts: async (configPorts, keys) => {
      portKeys = keys;
      return { gateway: 8642, dashboard: 9119, ssh: 2222 };
    },
  }));
  expect(portKeys).toContain('ssh');
});

test('run omits the ssh port when ssh is disabled', async () => {
  let portKeys;
  await run(['node', 'init', '/cfg.yaml'], stubDeps({
    resolvePorts: async (configPorts, keys) => {
      portKeys = keys;
      return { gateway: 8642, dashboard: 9119 };
    },
  }));
  expect(portKeys).not.toContain('ssh');
});
