// M2-S3: per-config settings_template is honored (config-dir-relative,
// missing-error, bare-name tool-dir fallback).

import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { syncConfig } from '../sync.js';

const HOME = process.env.HOME || homedir();
const silent = { log: () => {}, warn: () => {}, home: HOME };

function setup(configTail, templateContent) {
  const root = mkdtempSync(join(tmpdir(), 'ai-st-'));
  const hostClaude = join(root, 'host');
  const target = join(root, 'agent-claude');
  mkdirSync(hostClaude, { recursive: true });
  mkdirSync(join(root, 'proj'), { recursive: true });
  // host settings has a whitelisted field + a non-whitelisted one
  writeFileSync(join(hostClaude, 'settings.json'),
    JSON.stringify({ effortLevel: 'high', permissions: { allow: ['Bash(sudo:*)'] } }));
  if (templateContent) writeFileSync(join(root, 'strict.json'), JSON.stringify(templateContent));
  const cfgFile = join(root, 'x.agent.yml');
  writeFileSync(cfgFile,
    `mounts:\n  - { host: ${target}, mode: claude }\n  - { host: ${join(root, 'proj')}, mode: rw }\n${configTail}`);
  return { hostClaude, target, cfgFile };
}

const runSync = (cfgFile, hostClaude) =>
  syncConfig({ configArg: cfgFile, sourceDir: hostClaude }, silent);

test('honors a config-dir-relative settings_template', () => {
  const { hostClaude, target, cfgFile } = setup('settings_template: ./strict.json\n', {
    permissions: { allow: [], deny: ['Bash(strict)'] },
    skipAutoPermissionPrompt: true,
    customMarker: 'strict',
  });
  runSync(cfgFile, hostClaude);
  const settings = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf-8'));

  expect(settings.customMarker).toBe('strict'); // from the custom template
  expect(settings.permissions).toEqual({ allow: [], deny: ['Bash(strict)'] }); // template stance wins
  expect(settings.effortLevel).toBe('high'); // host whitelist overlay still applied
});

test('errors when settings_template is set but missing', () => {
  const { hostClaude, cfgFile } = setup('settings_template: ./nope.json\n', null);
  expect(() => runSync(cfgFile, hostClaude)).toThrow(/settings_template not found/);
});

test('falls back to the tool dir for a bare-name settings_template', () => {
  // settings.container.json.example lives in the tool dir, not beside the config
  const { hostClaude, target, cfgFile } = setup('settings_template: settings.container.json.example\n', null);
  runSync(cfgFile, hostClaude);
  const settings = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf-8'));
  expect(settings.permissions.deny).toContain('Bash(rm -rf:*)'); // the tool-dir example's stance
});
