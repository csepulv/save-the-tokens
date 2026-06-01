import { test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch } from '../launch.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HOME = '/Users/test';

// Injected deps that make the create path deterministic.
const makeDeps = (overrides = {}) => {
  const runDocker = [];
  const finished = [];
  const deps = {
    log: () => {},
    warn: () => {},
    home: HOME,
    dirExists: () => true,
    publishedPorts: () => new Set(),
    imageExists: () => true,
    runDocker: (argv) => runDocker.push(argv),
    finishSession: (args) => finished.push(args),
    inspectState: () => 'absent',
    writeState: () => {},
    checkNetwork: () => true,
    isPortFree: () => true,
    inspectPublishedPorts: () => [],
    ...overrides,
  };
  return { deps, runDocker, finished };
};

const cfg = (name) => ({ configArg: join(FIXTURES, name) });

test('absent container, dry-run builds a create command and does not run docker', () => {
  const { deps, runDocker } = makeDeps();
  const result = launch({ ...cfg('launch.agent.yml'), dryRun: true }, deps);

  expect(result.action).toBe('create');
  expect(result.dryRun).toBe(true);
  expect(runDocker).toEqual([]);

  const joined = result.command.join(' ');
  expect(joined).toContain('--name agent-demo --hostname demo-host -it');
  expect(joined).toContain(`-v ${HOME}/agent-claude:/home/agent/.claude:rw`);
  expect(joined).toContain(`-v ${HOME}/proj:/workspace/proj:rw`);
  expect(joined).toContain(`-v ${HOME}/ref:/reference/ref:ro`);
  expect(joined).toContain('-w /workspace/proj');
  expect(joined).toContain('-p 3118:3118 -p 5173:5173');
  expect(joined).toContain('-e A=1');
  expect(joined).toContain('claude-agent:latest bash');
});

test('running container attaches (docker exec) under dry-run', () => {
  const { deps } = makeDeps({ inspectState: () => 'running' });
  const result = launch({ ...cfg('launch.agent.yml'), dryRun: true }, deps);
  expect(result.action).toBe('attach');
  expect(result.command).toEqual(['docker', 'exec', '-it', 'agent-demo', 'zsh']);
});

test('exited container resumes (docker start) under dry-run', () => {
  const { deps } = makeDeps({ inspectState: () => 'exited' });
  const result = launch({ ...cfg('launch.agent.yml'), dryRun: true }, deps);
  expect(result.action).toBe('resume');
  expect(result.command).toEqual(['docker', 'start', '-ai', 'agent-demo']);
});

test('absent container, real run executes docker and finishes the session', () => {
  const { deps, runDocker, finished } = makeDeps();
  const result = launch(cfg('launch.agent.yml'), deps);
  expect(result.action).toBe('create');
  expect(runDocker).toHaveLength(1);
  expect(runDocker[0][0]).toBe('docker');
  expect(finished).toHaveLength(1);
});

test('autonomous mode runs claude -p with the prompt', () => {
  const { deps } = makeDeps();
  const result = launch({ ...cfg('launch.agent.yml'), autonomous: 'do it', dryRun: true }, deps);
  expect(result.command.slice(-4)).toEqual(['claude', '-p', 'do it', '--dangerously-skip-permissions']);
});

test('--name overrides the container name', () => {
  const { deps } = makeDeps();
  const result = launch({ ...cfg('launch.agent.yml'), name: 'custom', dryRun: true }, deps);
  expect(result.command).toContain('custom');
  expect(result.command.join(' ')).toContain('--name custom');
});

test('OAuth host port increments when 3118 is published', () => {
  const { deps } = makeDeps({ publishedPorts: () => new Set([3118]) });
  const result = launch({ ...cfg('launch.agent.yml'), dryRun: true }, deps);
  expect(result.command.join(' ')).toContain('-p 3119:3118');
});

test('throws when the config has no rw mount', () => {
  const { deps } = makeDeps();
  expect(() => launch(cfg('norw.agent.yml'), deps)).toThrow(/No rw mount/);
});

test('throws on an unexpected container state', () => {
  const { deps } = makeDeps({ inspectState: () => 'paused' });
  expect(() => launch(cfg('launch.agent.yml'), deps)).toThrow(/unexpected state/);
});

test('mode: daemon routes to emitDaemon and skips the interactive flow', () => {
  const seen = [];
  const { deps, runDocker } = makeDeps({
    emitDaemon: (configFile) => { seen.push(configFile); return { action: 'daemon', composePath: '/ws/docker-compose.yml' }; },
  });
  const result = launch(cfg('daemon.agent.yml'), deps);
  expect(result).toEqual({ action: 'daemon', composePath: '/ws/docker-compose.yml' });
  expect(seen).toHaveLength(1);
  expect(runDocker).toEqual([]); // the interactive state machine never ran
});

test('warns when re-entering a container that is not on the configured network', () => {
  const warnings = [];
  const { deps } = makeDeps({
    inspectState: () => 'running',
    checkNetwork: () => false,
    warn: (m) => warnings.push(m),
  });
  launch(cfg('network.agent.yml'), deps);
  expect(warnings.join('\n')).toMatch(/agent-net is not on network 'testnet'/);
});

test('resolves a relative services path against the config file dir', () => {
  const seen = [];
  const { deps } = makeDeps({
    resolveNetwork: (p) => { seen.push(p); return 'svcnet'; },
  });
  launch({ ...cfg('services.agent.yml'), dryRun: true }, deps);
  expect(seen).toEqual([join(FIXTURES, 'my.services.compose.yml')]);
});

test('does not warn when the container is on the configured network', () => {
  const warnings = [];
  const { deps } = makeDeps({
    inspectState: () => 'running',
    checkNetwork: () => true,
    warn: (m) => warnings.push(m),
  });
  launch(cfg('network.agent.yml'), deps);
  expect(warnings).toEqual([]);
});

// ── port conflicts + half-started teardown ─────────────────────────
test('remaps a conflicting host port when the user accepts', () => {
  const { deps, runDocker } = makeDeps({
    isPortFree: (p) => p !== 5173, // 5173 busy, 5174 free
    prompt: () => 'y',
  });
  launch(cfg('launch.agent.yml'), deps); // fixture publishes 5173
  const joined = runDocker[0].join(' ');
  expect(joined).toContain('-p 5174:5173'); // host side remapped, container unchanged
  expect(joined).not.toContain('-p 5173:5173');
});

test('aborts before starting services when a port conflict is declined', () => {
  const ensureCalls = [];
  const { deps } = makeDeps({
    isPortFree: (p) => p !== 5173,
    prompt: () => '', // bare Enter = decline (default N)
    resolveNetwork: () => 'svcnet',
    ensureServices: (...args) => ensureCalls.push(args),
  });
  expect(() => launch(cfg('services.agent.yml'), deps)).toThrow(/Port 5173 is in use/);
  expect(ensureCalls).toEqual([]); // services never started
});

test('a non-zero container exit is captured as a normal session end, not a failure', () => {
  // The user's shell exits non-zero — must NOT throw, rm, or treat as failure.
  const { deps, finished } = makeDeps({
    runDocker: () => { const e = new Error('exited'); e.status = 127; throw e; },
  });
  const result = launch(cfg('launch.agent.yml'), deps);
  expect(result).toMatchObject({ action: 'create', exitCode: 127 });
  expect(finished).toHaveLength(1); // finishSession (teardown prompt) ran normally
});

test('a clean container exit returns exitCode 0', () => {
  const { deps } = makeDeps();
  expect(launch(cfg('launch.agent.yml'), deps).exitCode).toBe(0);
});

test('resume aborts with a clear message when a baked-in port is now in use', () => {
  const ensureCalls = [];
  const { deps } = makeDeps({
    inspectState: () => 'exited',
    inspectPublishedPorts: () => [4000],
    isPortFree: (p) => p !== 4000,
    resolveNetwork: () => 'svcnet',
    ensureServices: (...args) => ensureCalls.push(args),
  });
  expect(() => launch(cfg('services.agent.yml'), deps)).toThrow(/publishes port 4000.*in use/);
  expect(ensureCalls).toEqual([]); // never reached services
});

test('resume proceeds when the baked-in ports are free', () => {
  const { deps, runDocker } = makeDeps({
    inspectState: () => 'exited',
    inspectPublishedPorts: () => [5173],
    isPortFree: () => true,
  });
  const result = launch(cfg('launch.agent.yml'), deps);
  expect(result.action).toBe('resume');
  expect(runDocker[0]).toEqual(['docker', 'start', '-ai', 'agent-demo']);
});
