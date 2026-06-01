import { test, expect } from 'vitest';
import {
  servicesProjectName,
  externalNetworkFromConfig,
  ensureServicesUp,
  teardownServices,
  postSession,
  agentOnNetwork,
} from '../services.js';

test('agentOnNetwork reports membership from the inspected network list', () => {
  const deps = { inspectNetworks: () => ['bridge', 'testnet'] };
  expect(agentOnNetwork('c', 'testnet', deps)).toBe(true);
  expect(agentOnNetwork('c', 'othernet', deps)).toBe(false);
});

test('servicesProjectName strips known suffixes and prefixes agent-svc-', () => {
  expect(servicesProjectName('jd.services.compose.yml')).toBe('agent-svc-jd');
  expect(servicesProjectName('services.compose.yml')).toBe('agent-svc-services');
  expect(servicesProjectName('/path/to/foo.yaml')).toBe('agent-svc-foo');
});

test('externalNetworkFromConfig returns the single external network', () => {
  const config = { networks: { agentnet: { external: true }, internal: {} } };
  expect(externalNetworkFromConfig(config)).toBe('agentnet');
});

test('externalNetworkFromConfig throws when no external network', () => {
  expect(() => externalNetworkFromConfig({ networks: { internal: {} } })).toThrow(/no external network/i);
});

test('externalNetworkFromConfig throws when more than one external network', () => {
  const config = { networks: { a: { external: true }, b: { external: true } } };
  expect(() => externalNetworkFromConfig(config)).toThrow(/expected exactly 1/i);
});

test('ensureServicesUp creates the network if missing and runs compose up --wait', () => {
  const calls = [];
  const deps = {
    networkExists: () => false,
    run: (argv) => calls.push(argv),
    log: () => {},
  };
  ensureServicesUp('jd.services.compose.yml', 'agentnet', deps);
  expect(calls).toEqual([
    ['docker', 'network', 'create', 'agentnet'],
    ['docker', 'compose', '-p', 'agent-svc-jd', '-f', 'jd.services.compose.yml', 'up', '-d', '--wait'],
  ]);
});

test('ensureServicesUp skips network creation when it already exists', () => {
  const calls = [];
  ensureServicesUp('jd.services.compose.yml', 'agentnet', {
    networkExists: () => true,
    run: (argv) => calls.push(argv),
    log: () => {},
  });
  expect(calls).toEqual([
    ['docker', 'compose', '-p', 'agent-svc-jd', '-f', 'jd.services.compose.yml', 'up', '-d', '--wait'],
  ]);
});

test('teardownServices runs compose down with the derived project name', () => {
  const calls = [];
  teardownServices('jd.services.compose.yml', { run: (argv) => calls.push(argv), log: () => {} });
  expect(calls).toEqual([['docker', 'compose', '-p', 'agent-svc-jd', '-f', 'jd.services.compose.yml', 'down']]);
});

// ── post_session branching (parity #10) ────────────────────────────
const tracker = (answer) => {
  const calls = { teardown: 0 };
  const deps = {
    prompt: () => answer,
    teardown: () => { calls.teardown += 1; },
    log: () => {},
  };
  return { calls, deps };
};

test('postSession (Mode B, no services file) leaves services untouched', () => {
  const { calls, deps } = tracker('');
  postSession({ servicesFile: '', network: 'somenet', agentRunning: false, autonomous: false }, deps);
  expect(calls.teardown).toBe(0);
});

test('postSession leaves services running while the agent container is up', () => {
  const { calls, deps } = tracker('');
  postSession({ servicesFile: 'x.services.compose.yml', network: 'n', agentRunning: true, autonomous: false }, deps);
  expect(calls.teardown).toBe(0);
});

test('postSession never prompts in autonomous mode', () => {
  const { calls, deps } = tracker('');
  postSession({ servicesFile: 'x.services.compose.yml', network: 'n', agentRunning: false, autonomous: true }, deps);
  expect(calls.teardown).toBe(0);
});

test('postSession tears down on bare Enter (default Y)', () => {
  const { calls, deps } = tracker('');
  postSession({ servicesFile: 'x.services.compose.yml', network: 'n', agentRunning: false, autonomous: false }, deps);
  expect(calls.teardown).toBe(1);
});

test('postSession tears down on explicit yes', () => {
  const { calls, deps } = tracker('yes');
  postSession({ servicesFile: 'x.services.compose.yml', network: 'n', agentRunning: false, autonomous: false }, deps);
  expect(calls.teardown).toBe(1);
});

test('postSession leaves services running on n', () => {
  const { calls, deps } = tracker('n');
  postSession({ servicesFile: 'x.services.compose.yml', network: 'n', agentRunning: false, autonomous: false }, deps);
  expect(calls.teardown).toBe(0);
});
