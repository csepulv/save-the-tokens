import { test, expect } from 'vitest';
import yaml from 'js-yaml';
import { emitDaemon } from '../emit.js';

const config = {
  containerName: 'agent-hermes',
  hermesWorkspace: '/home/u/ws',
  launchOnBoot: true,
  ports: { gateway: 8642, dashboard: 9119, ssh: 2222 },
  ssh: { enabled: true, password: 'p' },
  env: { ANTHROPIC_API_KEY: 'sk' },
  mounts: [{ host: '/home/u/proj', mode: 'rw', containerPath: '/workspace/proj' }],
};

const baseDeps = (over = {}) => ({
  loadConfig: () => config,
  ensureWorkspace: () => ({ hermesDir: '/home/u/ws/hermes', claudeDir: '/home/u/ws/claude-code' }),
  seedClaudeConfig: () => ({ seeded: true }),
  resolvePorts: (cp) => cp, // explicit ports → verbatim
  getUid: () => 501,
  getGid: () => 20,
  log: () => {},
  ...over,
});

test('orchestrates load→workspace→seed→ports→compose→write and returns the path', () => {
  const writes = [];
  const result = emitDaemon('/cfg.yml', baseDeps({ writeFile: (p, c) => writes.push({ p, c }) }));

  expect(result).toEqual(expect.objectContaining({
    action: 'daemon',
    composePath: '/home/u/ws/docker-compose.yml',
    ports: { gateway: 8642, dashboard: 9119, ssh: 2222 },
  }));
  expect(writes).toHaveLength(1);
  expect(writes[0].p).toBe('/home/u/ws/docker-compose.yml');

  const compose = yaml.load(writes[0].c);
  expect(compose.name).toBe('agent-hermes');
  expect(Object.keys(compose.services)).toEqual(['hermes']);
  expect(compose.services.hermes.environment.HERMES_UID).toBe('501');
});

test('requests the ssh port key only when ssh is enabled', () => {
  const seen = [];
  emitDaemon('/cfg.yml', baseDeps({
    resolvePorts: (cp, keys) => { seen.push(keys); return cp; },
    writeFile: () => {},
  }));
  expect(seen[0]).toEqual(['gateway', 'dashboard', 'ssh']);

  const seen2 = [];
  emitDaemon('/cfg.yml', baseDeps({
    loadConfig: () => ({ ...config, ssh: { enabled: false } }),
    resolvePorts: (cp, keys) => { seen2.push(keys); return cp; },
    writeFile: () => {},
  }));
  expect(seen2[0]).toEqual(['gateway', 'dashboard']);
});

test('prints next-steps including the compose path and dashboard URL', () => {
  const lines = [];
  emitDaemon('/cfg.yml', baseDeps({ writeFile: () => {}, log: (m) => lines.push(m) }));
  const out = lines.join('\n');
  expect(out).toContain('docker compose -f /home/u/ws/docker-compose.yml up -d');
  expect(out).toContain('dashboard: http://localhost:9119');
  expect(out).toContain('ssh hermes@localhost -p 2222');
});

test('a build config emits a compose build block and an `up -d --build` next-step', () => {
  const writes = [];
  const lines = [];
  emitDaemon('/cfg.yml', baseDeps({
    loadConfig: () => ({ ...config, build: { dockerfile: '/abs/docker/Dockerfile', args: { DUCKDB_ARCH: 'aarch64' } } }),
    fileExists: () => true,
    writeFile: (p, c) => writes.push(c),
    log: (m) => lines.push(m),
  }));
  const compose = yaml.load(writes[0]);
  expect(compose.services.hermes.build).toEqual({
    context: '/abs/docker', dockerfile: 'Dockerfile', args: { DUCKDB_ARCH: 'aarch64' },
  });
  expect(compose.services.hermes.image).toBe('agent-hermes:local');
  expect(lines.join('\n')).toContain('docker compose -f /home/u/ws/docker-compose.yml up -d --build');
});

test('fails fast when build.dockerfile does not exist', () => {
  expect(() => emitDaemon('/cfg.yml', baseDeps({
    loadConfig: () => ({ ...config, build: { dockerfile: '/abs/missing/Dockerfile' } }),
    fileExists: () => false,
    writeFile: () => {},
  }))).toThrow(/dockerfile.*not found|not found.*Dockerfile/i);
});
