import { test, expect } from 'vitest';
import { buildCompose } from '../compose.js';

const baseConfig = {
  containerName: 'hermes-personal',
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

test('buildCompose produces a two-service compose with the project name', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.name).toBe('hermes-personal');
  expect(Object.keys(c.services)).toEqual(['gateway', 'dashboard']);
  expect(c.services.gateway.container_name).toBe('hermes-personal');
  expect(c.services.dashboard.container_name).toBe('hermes-personal-dashboard');
});

test('gateway and dashboard get loopback-bound API/dashboard ports', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.gateway.ports).toContain('127.0.0.1:8642:8642');
  expect(c.services.dashboard.ports).toEqual(['127.0.0.1:9119:9119']);
});

test('volumes include the base mounts plus user mounts with mode suffix', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.gateway.volumes).toEqual(expect.arrayContaining([
    '/home/u/ws/hermes:/opt/data',
    '/home/u/ws/claude-code:/opt/data/.claude',
    '/home/u/proj:/workspace/proj',
    '/home/u/docs:/reference/docs:ro',
  ]));
});

test('env block goes to the gateway only; both services get HERMES_UID/GID', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.gateway.environment).toMatchObject({
    HERMES_UID: '501',
    HERMES_GID: '20',
    ANTHROPIC_API_KEY: 'sk-test',
  });
  expect(c.services.dashboard.environment.ANTHROPIC_API_KEY).toBeUndefined();
  expect(c.services.dashboard.environment).toMatchObject({ HERMES_UID: '501', HERMES_GID: '20' });
});

test('restart policy follows launch_on_boot', () => {
  expect(buildCompose(baseConfig, ports, identity).services.gateway.restart).toBe('unless-stopped');
  const off = buildCompose({ ...baseConfig, launchOnBoot: false }, ports, identity);
  expect(off.services.gateway.restart).toBe('no');
  expect(off.services.dashboard.restart).toBe('no');
});

test('SSH enabled: gateway gets the ssh port + SSH_ENABLED/SSH_PASSWORD; dashboard SSH_ENABLED=false', () => {
  const c = buildCompose(baseConfig, ports, identity);
  expect(c.services.gateway.ports).toContain('2222:22');
  expect(c.services.gateway.environment.SSH_ENABLED).toBe('true');
  expect(c.services.gateway.environment.SSH_PASSWORD).toBe('secret');
  expect(c.services.dashboard.environment.SSH_ENABLED).toBe('false');
});

test('SSH enabled with authorized_key: gateway mounts the pubkey, dashboard does not', () => {
  const cfg = {
    ...baseConfig,
    ssh: { enabled: true, password: 'p', authorizedKey: '/home/u/.ssh/id.pub' },
  };
  const c = buildCompose(cfg, ports, identity);
  expect(c.services.gateway.volumes).toContain('/home/u/.ssh/id.pub:/etc/ssh/keys/hermes:ro');
  expect(c.services.dashboard.volumes).not.toContain('/home/u/.ssh/id.pub:/etc/ssh/keys/hermes:ro');
});

test('SSH disabled: no :22 port, SSH_ENABLED=false on both, no SSH_PASSWORD', () => {
  const cfg = { ...baseConfig, ssh: { enabled: false } };
  const c = buildCompose(cfg, { gateway: 8642, dashboard: 9119 }, identity);
  const allPorts = [...c.services.gateway.ports, ...c.services.dashboard.ports];
  expect(allPorts.some((p) => p.endsWith(':22'))).toBe(false);
  expect(c.services.gateway.environment.SSH_ENABLED).toBe('false');
  expect(c.services.dashboard.environment.SSH_ENABLED).toBe('false');
  expect(c.services.gateway.environment.SSH_PASSWORD).toBeUndefined();
});
