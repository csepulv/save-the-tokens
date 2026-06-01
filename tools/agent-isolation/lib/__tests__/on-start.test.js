import { test, expect } from 'vitest';
import { stateDir, writeOnStart } from '../on-start.js';

test('stateDir is ~/.agent-isolation/state/<container>', () => {
  expect(stateDir('/Users/test', 'agent-x')).toBe('/Users/test/.agent-isolation/state/agent-x');
});

test('writeOnStart writes on-start.json when an on_start block is present', () => {
  const calls = { mkdir: [], write: [], remove: [] };
  const deps = {
    mkdir: (d) => calls.mkdir.push(d),
    writeFile: (f, c) => calls.write.push([f, c]),
    remove: (f) => calls.remove.push(f),
  };
  const onStart = { command: 'node x.js', log: '/tmp/x.log' };
  writeOnStart('/state/agent-x', onStart, deps);

  expect(calls.mkdir).toEqual(['/state/agent-x']);
  expect(calls.write).toEqual([['/state/agent-x/on-start.json', `${JSON.stringify(onStart)}\n`]]);
  expect(calls.remove).toEqual([]);
});

test('writeOnStart removes a stale on-start.json when there is no on_start block', () => {
  const calls = { mkdir: [], write: [], remove: [] };
  const deps = {
    mkdir: (d) => calls.mkdir.push(d),
    writeFile: (f, c) => calls.write.push([f, c]),
    remove: (f) => calls.remove.push(f),
  };
  writeOnStart('/state/agent-x', null, deps);

  expect(calls.mkdir).toEqual(['/state/agent-x']);
  expect(calls.write).toEqual([]);
  expect(calls.remove).toEqual(['/state/agent-x/on-start.json']);
});
