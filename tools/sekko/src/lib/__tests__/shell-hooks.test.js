import { test, expect, describe } from 'vitest';
import { generateZshHookScript, generateBashHookScript, generateHookScript } from '../shell-hooks.js';

describe('generateZshHookScript', () => {
  test('contains zsh/datetime module load', () => {
    const script = generateZshHookScript();
    expect(script).toContain('zmodload zsh/datetime');
  });

  test('uses add-zsh-hook for preexec and precmd', () => {
    const script = generateZshHookScript();
    expect(script).toContain('add-zsh-hook preexec __sekko_preexec');
    expect(script).toContain('add-zsh-hook precmd __sekko_precmd');
  });

  test('uses EPOCHREALTIME for ms precision timestamps', () => {
    const script = generateZshHookScript();
    expect(script).toContain('EPOCHREALTIME');
  });

  test('emits SEKKO_CMD_START and SEKKO_CMD_END markers', () => {
    const script = generateZshHookScript();
    expect(script).toContain('<<<SEKKO_CMD_START:');
    expect(script).toContain('<<<SEKKO_CMD_END:');
  });

  test('includes exit code in CMD_END marker', () => {
    const script = generateZshHookScript();
    expect(script).toMatch(/SEKKO_CMD_END:.*exit_code/);
  });
});

describe('generateBashHookScript', () => {
  test('sources bash-preexec from known locations', () => {
    const script = generateBashHookScript();
    expect(script).toContain('bash-preexec.sh');
    expect(script).toContain('/opt/homebrew/');
  });

  test('warns if bash-preexec not found', () => {
    const script = generateBashHookScript();
    expect(script).toContain('Warning: bash-preexec not found');
  });

  test('uses date +%s for second precision timestamps', () => {
    const script = generateBashHookScript();
    expect(script).toContain('date +%s');
  });

  test('emits SEKKO markers', () => {
    const script = generateBashHookScript();
    expect(script).toContain('<<<SEKKO_CMD_START:');
    expect(script).toContain('<<<SEKKO_CMD_END:');
  });
});

describe('generateHookScript', () => {
  test('returns zsh script by default', () => {
    const script = generateHookScript('zsh');
    expect(script).toContain('zmodload zsh/datetime');
  });

  test('returns bash script when specified', () => {
    const script = generateHookScript('bash');
    expect(script).toContain('bash-preexec');
  });
});
