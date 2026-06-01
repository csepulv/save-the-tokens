import { test, expect } from 'vitest';
import { run } from '../cli.js';

const argv = (...args) => ['node', 'agent-isolation', ...args];

const spies = () => {
  const calls = { launch: [], sync: [], build: [], buildDaemon: [] };
  const handlers = {
    launch: (o) => calls.launch.push(o),
    sync: (o) => calls.sync.push(o),
    build: (o) => calls.build.push(o),
    buildDaemon: (o) => calls.buildDaemon.push(o),
  };
  return { calls, handlers };
};

test('launch parses flags into the launch options', () => {
  const { calls, handlers } = spies();
  run(argv('launch', '--config', 'x.agent.yml', '--name', 'n', '--dry-run'), handlers);
  expect(calls.launch[0]).toEqual({
    configArg: 'x.agent.yml', name: 'n', autonomous: '', resume: false, build: false, dryRun: true,
  });
});

test('launch --autonomous and --resume parse through', () => {
  const { calls, handlers } = spies();
  run(argv('launch', '--autonomous', 'do it', '--resume'), handlers);
  expect(calls.launch[0]).toMatchObject({ autonomous: 'do it', resume: true });
});

test('sync parses flags into the sync options', () => {
  const { calls, handlers } = spies();
  run(argv('sync', '--source', '~/work-claude', '--force', '--include-all'), handlers);
  expect(calls.sync[0]).toEqual({
    configArg: '', sourceDir: '~/work-claude', force: true, headless: false, includeAll: true,
  });
});

test('build maps --no-cache to noCache', () => {
  const { calls, handlers } = spies();
  run(argv('build', '--no-cache'), handlers);
  expect(calls.build[0]).toEqual({ noCache: true });
});

test('build defaults noCache to false', () => {
  const { calls, handlers } = spies();
  run(argv('build'), handlers);
  expect(calls.build[0]).toEqual({ noCache: false });
  expect(calls.buildDaemon).toEqual([]); // interactive, not daemon
});

test('build daemon routes to the daemon build', () => {
  const { calls, handlers } = spies();
  run(argv('build', 'daemon', '--no-cache'), handlers);
  expect(calls.buildDaemon[0]).toEqual({ noCache: true });
  expect(calls.build).toEqual([]); // interactive build not invoked
});
