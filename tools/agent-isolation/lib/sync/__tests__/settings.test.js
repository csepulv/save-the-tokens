import { test, expect } from 'vitest';
import { composeSettings, SETTINGS_WHITELIST } from '../settings.js';

const template = {
  permissions: { allow: [], deny: ['Bash(rm -rf:*)'] },
  skipAutoPermissionPrompt: true,
};

test('overlays only whitelisted host fields onto the template', () => {
  const host = {
    enabledPlugins: { 'discord@x': true },
    extraKnownMarketplaces: { foo: {} },
    statusLine: { type: 'command' },
    effortLevel: 'high',
    env: { A: '1' },
    // NOT whitelisted — must be dropped:
    permissions: { allow: ['Bash(sudo:*)'] },
    hooks: { SessionEnd: [] },
  };
  const out = composeSettings(template, host);

  expect(out.enabledPlugins).toEqual({ 'discord@x': true });
  expect(out.extraKnownMarketplaces).toEqual({ foo: {} });
  expect(out.statusLine).toEqual({ type: 'command' });
  expect(out.effortLevel).toBe('high');
  expect(out.env).toEqual({ A: '1' });
  // template stance preserved; host permissions/hooks excluded
  expect(out.permissions).toEqual({ allow: [], deny: ['Bash(rm -rf:*)'] });
  expect(out.skipAutoPermissionPrompt).toBe(true);
  expect(out.hooks).toBeUndefined();
});

test('returns the template unchanged when there is no host settings', () => {
  expect(composeSettings(template, null)).toEqual(template);
});

test('omits whitelisted keys the host does not have', () => {
  const out = composeSettings(template, { effortLevel: 'high' });
  expect('voice' in out).toBe(false);
  expect(out.effortLevel).toBe('high');
});

test('whitelist excludes permissions and hooks', () => {
  expect(SETTINGS_WHITELIST).not.toContain('permissions');
  expect(SETTINGS_WHITELIST).not.toContain('hooks');
});
