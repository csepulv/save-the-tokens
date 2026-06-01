import { test, expect } from 'vitest';
import { unwrapMcp, selectedPluginNames, injectMcp, deepMerge } from '../mcp-inject.js';

test('unwrapMcp handles wrapped and wrapperless plugin shapes', () => {
  // wrapped (discord-style)
  expect(unwrapMcp({ mcpServers: { discord: { command: 'd' } } })).toEqual({ discord: { command: 'd' } });
  // wrapperless (context7/github/etc.)
  expect(unwrapMcp({ context7: { command: 'c' } })).toEqual({ context7: { command: 'c' } });
});

test('selectedPluginNames strips @version and always includes slack', () => {
  const settings = { enabledPlugins: { 'discord@1.2': true, 'context7@x': true } };
  const names = selectedPluginNames(settings);
  expect(names.has('discord')).toBe(true);
  expect(names.has('context7')).toBe(true);
  expect(names.has('slack')).toBe(true); // EXTRA_PLUGINS
});

test('selectedPluginNames tolerates missing enabledPlugins', () => {
  expect(selectedPluginNames({}).has('slack')).toBe(true);
});

test('injectMcp merges plugin servers into settings.mcpServers', () => {
  const settings = { mcpServers: { existing: { command: 'e' } }, statusLine: { type: 'command' } };
  const parsed = [
    { mcpServers: { discord: { command: 'd' } } }, // wrapped
    { context7: { command: 'c' } }, // wrapperless
  ];
  const out = injectMcp(settings, parsed, {});
  expect(out.mcpServers).toEqual({
    existing: { command: 'e' },
    discord: { command: 'd' },
    context7: { command: 'c' },
  });
  expect(out.statusLine).toEqual({ type: 'command' }); // kept when not headless
});

test('injectMcp strips statusLine in headless mode', () => {
  const settings = { mcpServers: {}, statusLine: { type: 'command' } };
  const out = injectMcp(settings, [], { headless: true });
  expect('statusLine' in out).toBe(false);
});

test('injectMcp seeds mcpServers when settings has none', () => {
  const out = injectMcp({}, [{ slack: { command: 's' } }], {});
  expect(out.mcpServers).toEqual({ slack: { command: 's' } });
});

test('deepMerge recursively merges objects, right wins on scalars', () => {
  expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({ a: { x: 1, y: 3, z: 4 } });
});
