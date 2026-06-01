import { test, expect } from 'vitest';
import { rewriteString, rewritePaths, buildMappings } from '../rewrite-paths.js';

const AGENT_HOME = '/home/agent';
const HOST_CLAUDE = '/Users/test/.claude';

test('rewriteString replaces a matching host prefix, first match wins', () => {
  const mappings = [
    { host: '/Users/test/.claude', container: '/home/agent/.claude' },
    { host: '/Users/test/ws/proj', container: '/workspace/proj' },
  ];
  expect(rewriteString('/Users/test/.claude/plugins/x', mappings)).toBe('/home/agent/.claude/plugins/x');
  expect(rewriteString('/Users/test/ws/proj/src', mappings)).toBe('/workspace/proj/src');
});

test('rewriteString leaves non-matching strings untouched', () => {
  const mappings = [{ host: '/Users/test/.claude', container: '/home/agent/.claude' }];
  expect(rewriteString('/etc/hosts', mappings)).toBe('/etc/hosts');
  expect(rewriteString('not a path', mappings)).toBe('not a path');
});

test('rewritePaths walks nested structures, transforming only string leaves', () => {
  const mappings = [{ host: '/Users/test/.claude', container: '/home/agent/.claude' }];
  const input = {
    installPath: '/Users/test/.claude/plugins/foo',
    enabled: true,
    count: 3,
    missing: null,
    nested: { paths: ['/Users/test/.claude/a', '/other'] },
  };
  expect(rewritePaths(input, mappings)).toEqual({
    installPath: '/home/agent/.claude/plugins/foo',
    enabled: true,
    count: 3,
    missing: null,
    nested: { paths: ['/home/agent/.claude/a', '/other'] },
  });
});

test('rewritePaths preserves object keys even when they look like paths', () => {
  const mappings = [{ host: '/Users/test/.claude', container: '/home/agent/.claude' }];
  const input = { '/Users/test/.claude': 'value' };
  // jq walk rewrites values, not keys.
  expect(rewritePaths(input, mappings)).toEqual({ '/Users/test/.claude': 'value' });
});

test('buildMappings seeds HOST_CLAUDE first and skips the claude mount', () => {
  const mounts = [
    { host: '/Users/test/agent-claude', mode: 'claude', containerPath: '/home/agent/.claude' },
    { host: '/Users/test/ws/proj', mode: 'rw', containerPath: '/workspace/proj' },
    { host: '/Users/test/ref', mode: 'ro', containerPath: '/reference/ref' },
    { host: '/Users/test/mcp-src', mode: 'mcp', containerPath: '/mcp/mcp-src' },
  ];
  expect(buildMappings(HOST_CLAUDE, mounts, AGENT_HOME)).toEqual([
    { host: HOST_CLAUDE, container: '/home/agent/.claude' },
    { host: '/Users/test/ws/proj', container: '/workspace/proj' },
    { host: '/Users/test/ref', container: '/reference/ref' },
    { host: '/Users/test/mcp-src', container: '/mcp/mcp-src' },
  ]);
});
