import { test, expect } from 'vitest';
import { buildRunCommand, formatCommand, execCommand, startCommand } from '../docker.js';

const base = {
  containerName: 'agent-tsugi',
  hostname: 'tsugi-dev',
  claudeDir: '/Users/test/agent-claude',
  stateDir: '/Users/test/.agent-isolation/state/agent-tsugi',
  volumeMounts: [
    { host: '/Users/test/ws/proj', containerPath: '/workspace/proj', dockerMode: 'rw' },
    { host: '/Users/test/ref', containerPath: '/reference/ref', dockerMode: 'ro' },
  ],
  workdir: '/workspace/proj',
  oauthHostPort: 3118,
  ports: [],
  envPairs: [],
  network: '',
};

test('builds the docker run argv in launch.sh order (interactive → bash)', () => {
  expect(buildRunCommand({ ...base, run: { mode: 'interactive' } })).toEqual([
    'docker', 'run',
    '--name', 'agent-tsugi',
    '--hostname', 'tsugi-dev',
    '-it',
    '-v', '/Users/test/agent-claude:/home/agent/.claude:rw',
    '-v', '/Users/test/.agent-isolation/state/agent-tsugi:/home/agent/.agent-isolation:ro',
    '-v', '/Users/test/ws/proj:/workspace/proj:rw',
    '-v', '/Users/test/ref:/reference/ref:ro',
    '-w', '/workspace/proj',
    '-p', '3118:3118',
    'claude-agent:latest',
    'bash',
  ]);
});

test('omits the claude mount when there is no claude dir', () => {
  const cmd = buildRunCommand({ ...base, claudeDir: null, run: { mode: 'interactive' } });
  expect(cmd).not.toContain('/Users/test/agent-claude:/home/agent/.claude:rw');
  // state-dir mount is still present
  expect(cmd).toContain('/Users/test/.agent-isolation/state/agent-tsugi:/home/agent/.agent-isolation:ro');
});

test('appends extra ports, env, and network in order', () => {
  const cmd = buildRunCommand({
    ...base,
    oauthHostPort: 3119,
    ports: ['5173:5173', '27017:27017'],
    envPairs: ['A=1', 'B=2'],
    network: 'mynet',
    run: { mode: 'interactive' },
  });
  const joined = cmd.join(' ');
  expect(joined).toContain('-p 3119:3118 -p 5173:5173 -p 27017:27017');
  expect(joined).toContain('-e A=1 -e B=2');
  expect(joined).toContain('--network mynet claude-agent:latest');
});

test('env_file: --env-file precedes -e so -e overrides', () => {
  const cmd = buildRunCommand({
    ...base, envFile: '/abs/secrets.env', envPairs: ['A=1'], run: { mode: 'interactive' },
  });
  const ef = cmd.indexOf('--env-file');
  expect(ef).toBeGreaterThan(-1);
  expect(cmd[ef + 1]).toBe('/abs/secrets.env');
  expect(ef).toBeLessThan(cmd.indexOf('-e')); // loaded before -e, so -e wins
});

test('no env_file → no --env-file flag', () => {
  expect(buildRunCommand({ ...base, run: { mode: 'interactive' } })).not.toContain('--env-file');
});

test('resume mode runs claude --continue', () => {
  const cmd = buildRunCommand({ ...base, run: { mode: 'resume' } });
  expect(cmd.slice(-3)).toEqual(['claude', '--dangerously-skip-permissions', '--continue']);
});

test('autonomous mode runs claude -p with the prompt', () => {
  const cmd = buildRunCommand({ ...base, run: { mode: 'autonomous', prompt: 'do the thing' } });
  expect(cmd.slice(-4)).toEqual(['claude', '-p', 'do the thing', '--dangerously-skip-permissions']);
});

test('formatCommand space-joins argv (matches bash ${CMD[*]})', () => {
  expect(formatCommand(['docker', 'run', '--name', 'x'])).toBe('docker run --name x');
});

test('execCommand and startCommand match launch.sh', () => {
  expect(execCommand('agent-tsugi')).toEqual(['docker', 'exec', '-it', 'agent-tsugi', 'zsh']);
  expect(startCommand('agent-tsugi')).toEqual(['docker', 'start', '-ai', 'agent-tsugi']);
});
