import { test, expect } from 'vitest';
import { buildImage, buildDaemonImage } from '../build.js';

test('buildImage builds claude-agent with host UID/GID args', () => {
  const calls = [];
  buildImage({}, { run: (a) => calls.push(a), uid: 501, gid: 20, log: () => {}, toolDir: '/tool' });
  const a = calls[0];
  expect(a.slice(0, 2)).toEqual(['docker', 'build']);
  expect(a).toEqual(expect.arrayContaining(['--build-arg', 'AGENT_UID=501', '--build-arg', 'AGENT_GID=20']));
  expect(a).toEqual(expect.arrayContaining(['-t', 'claude-agent:latest', '/tool']));
});

test('buildDaemonImage builds hermes-claude from the daemon Dockerfile, no UID args', () => {
  const calls = [];
  buildDaemonImage({}, { run: (a) => calls.push(a), log: () => {}, daemonDir: '/tool/daemon-image' });
  const a = calls[0];
  expect(a).toEqual([
    'docker', 'build',
    '-f', '/tool/daemon-image/Dockerfile',
    '-t', 'hermes-claude:20260530', // date-tagged, not :latest
    '/tool/daemon-image',
  ]);
  expect(a.join(' ')).not.toContain('AGENT_UID'); // hermes handles UID at runtime
  expect(a.join(' ')).not.toContain(':latest'); // never the moving target
});

test('--no-cache passes through on both builds', () => {
  const calls = [];
  buildImage({ noCache: true }, { run: (a) => calls.push(a), uid: 1, gid: 1, log: () => {}, toolDir: '/t' });
  buildDaemonImage({ noCache: true }, { run: (a) => calls.push(a), log: () => {}, daemonDir: '/d' });
  expect(calls[0]).toContain('--no-cache');
  expect(calls[1]).toContain('--no-cache');
});
