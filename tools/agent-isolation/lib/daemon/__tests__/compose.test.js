// Single-service (s6-base) daemon compose. Rewritten in M3b — the new base
// runs gateway (CMD) + dashboard (s6 service) in ONE container.
import { test, expect } from 'vitest';
import { buildCompose } from '../compose.js';

const baseConfig = {
  containerName: 'agent-hermes',
  hermesWorkspace: '/home/u/ws',
  launchOnBoot: true,
  ports: {},
  ssh: { enabled: true, password: 'secret' },
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  mounts: [
    { host: '/home/u/proj', mode: 'rw', containerPath: '/workspace/proj' },
    { host: '/home/u/docs', mode: 'ro', containerPath: '/reference/docs' },
  ],
};
const ports = { gateway: 8642, dashboard: 9119, ssh: 2222 };
const identity = { uid: 501, gid: 20 };

test('buildCompose produces a single hermes service running `gateway run`', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.name).toBe('agent-hermes');
  expect(Object.keys(c.services)).toEqual(['hermes']);
  expect(c.services.hermes.container_name).toBe('agent-hermes');
  expect(c.services.hermes.command).toEqual(['gateway', 'run']);
  // image is the date-tagged daemon ref, never :latest (the moving target)
  expect(c.services.hermes.image).toBe('hermes-claude:20260530');
});

test('gateway + dashboard ports published loopback on the one container', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.hermes.ports).toEqual(expect.arrayContaining([
    '127.0.0.1:8642:8642', '127.0.0.1:9119:9119',
  ]));
});

test('dashboard enabled + insecure via env; UID/GID + user env present', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.hermes.environment).toMatchObject({
    HERMES_UID: '501',
    HERMES_GID: '20',
    HERMES_DASHBOARD: 'true',
    HERMES_DASHBOARD_INSECURE: 'true',
    ANTHROPIC_API_KEY: 'sk-test',
  });
});

test('volumes include the /opt/data mounts plus user mounts with mode suffix', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.hermes.volumes).toEqual(expect.arrayContaining([
    '/home/u/ws/hermes:/opt/data',
    '/home/u/ws/claude-code:/opt/data/.claude',
    '/home/u/proj:/workspace/proj',
    '/home/u/docs:/reference/docs:ro',
  ]));
});

test('restart policy follows launch_on_boot', () => {
  expect(buildCompose(baseConfig, ports, identity).services.hermes.restart).toBe('unless-stopped');
  expect(buildCompose({ ...baseConfig, launchOnBoot: false }, ports, identity).services.hermes.restart).toBe('no');
});

test('SSH enabled: ssh port + SSH_ENABLED/SSH_PASSWORD env', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.hermes.ports).toContain('2222:22');
  expect(c.services.hermes.environment.SSH_ENABLED).toBe('true');
  expect(c.services.hermes.environment.SSH_PASSWORD).toBe('secret');
});

test('SSH with authorized_key: mounts the pubkey', () => {
  const c = buildCompose(
    { ...baseConfig, ssh: { enabled: true, password: 'p', authorizedKey: '/home/u/.ssh/id.pub' } },
    ports, identity,
  );
  expect(c.services.hermes.volumes).toContain('/home/u/.ssh/id.pub:/etc/ssh/keys/hermes:ro');
});

test('SSH disabled: no :22 port, SSH_ENABLED=false, no password', () => {
  const c = buildCompose({ ...baseConfig, ssh: { enabled: false } }, { gateway: 8642, dashboard: 9119 }, identity);
  expect(c.services.hermes.ports.some((p) => p.endsWith(':22'))).toBe(false);
  expect(c.services.hermes.environment.SSH_ENABLED).toBe('false');
  expect(c.services.hermes.environment.SSH_PASSWORD).toBeUndefined();
});

// ── env_file ──
test('env_file present → emitted on the service', () => {
  const c = buildCompose({ ...baseConfig, envFile: '/abs/secrets.env' }, ports, identity);
  expect(c.services.hermes.env_file).toEqual(['/abs/secrets.env']);
});

test('no env_file → no env_file key', () => {
  expect(buildCompose(baseConfig, ports, identity).services.hermes.env_file).toBeUndefined();
});

// ── per-container image extension (`build:`) ──────────────────────────
test('build present → compose build block + per-container image tag (no bare base image)', () => {
  const c = buildCompose(
    { ...baseConfig, build: { dockerfile: '/abs/docker/Dockerfile', args: { DUCKDB_ARCH: 'aarch64' } } },
    ports, identity,
  );
  expect(c.services.hermes.build).toEqual({
    context: '/abs/docker',
    dockerfile: 'Dockerfile',
    args: { DUCKDB_ARCH: 'aarch64' },
  });
  expect(c.services.hermes.image).toBe('agent-hermes:local'); // <container_name>:local, not the base
});

test('build with explicit context → dockerfile relative to it', () => {
  const c = buildCompose(
    { ...baseConfig, build: { dockerfile: '/abs/sub/Dockerfile', context: '/abs' } },
    ports, identity,
  );
  expect(c.services.hermes.build).toEqual({ context: '/abs', dockerfile: 'sub/Dockerfile' });
});

test('build absent → base image, no build block (regression)', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.hermes.image).toBe('hermes-claude:20260530');
  expect(c.services.hermes.build).toBeUndefined();
});
