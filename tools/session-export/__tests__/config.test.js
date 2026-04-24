import { test, expect } from 'vitest';
import { loadConfig, resolveSource, resolveOutputPath } from '../lib/config.js';

function makeDeps(fileContent = null) {
  const readFile = async (path) => {
    if (fileContent === null) {
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'ENOENT';
      throw err;
    }
    return fileContent;
  };
  const homedir = () => '/Users/test';
  return { readFile, homedir };
}

// --- loadConfig ---

test('returns defaults when no config file exists', async () => {
  const config = await loadConfig(makeDeps(null));
  expect(config.outputDir).toBeNull();
  expect(config.sources.default).toBe('/Users/test/.claude');
});

test('loads outputDir from config', async () => {
  const yaml = 'outputDir: ~/exports\n';
  const config = await loadConfig(makeDeps(yaml));
  expect(config.outputDir).toBe('/Users/test/exports');
});

test('loads sources from config', async () => {
  const yaml = [
    'sources:',
    '  default: ~/.claude',
    '  work: ~/.work-claude',
  ].join('\n');
  const config = await loadConfig(makeDeps(yaml));
  expect(config.sources.default).toBe('/Users/test/.claude');
  expect(config.sources.work).toBe('/Users/test/.work-claude');
});

test('adds default source if not specified in sources', async () => {
  const yaml = [
    'sources:',
    '  work: ~/.work-claude',
  ].join('\n');
  const config = await loadConfig(makeDeps(yaml));
  expect(config.sources.default).toBe('/Users/test/.claude');
  expect(config.sources.work).toBe('/Users/test/.work-claude');
});

test('rethrows non-ENOENT errors', async () => {
  const deps = {
    readFile: async () => { throw new Error('EPERM'); },
    homedir: () => '/Users/test',
  };
  await expect(loadConfig(deps)).rejects.toThrow('EPERM');
});

test('handles empty config file', async () => {
  const config = await loadConfig(makeDeps(''));
  expect(config.outputDir).toBeNull();
  expect(config.sources.default).toBe('/Users/test/.claude');
});

// --- resolveSource ---

test('returns default source when no name given', () => {
  const config = { sources: { default: '/home/.claude' } };
  expect(resolveSource(null, config)).toBe('/home/.claude');
  expect(resolveSource(undefined, config)).toBe('/home/.claude');
});

test('resolves alias from config', () => {
  const config = { sources: { default: '/home/.claude', work: '/home/.work-claude' } };
  expect(resolveSource('work', config)).toBe('/home/.work-claude');
});

test('treats value with slash as path', () => {
  const config = { sources: { default: '/home/.claude' } };
  expect(resolveSource('/custom/path', config)).toBe('/custom/path');
});

test('expands tilde in path value', () => {
  const config = { sources: { default: '/home/.claude' } };
  const result = resolveSource('~/.other-claude', config);
  expect(result).toContain('.other-claude');
  expect(result.startsWith('~')).toBe(false);
});

test('falls back to raw value when no alias match and no slash', () => {
  const config = { sources: { default: '/home/.claude' } };
  expect(resolveSource('unknown', config)).toBe('unknown');
});

// --- resolveOutputPath ---

function makeConversation(title = null, sessionId = 'abc-123') {
  return { metadata: { customTitle: title, sessionId } };
}

test('returns null when output flag is undefined (stdout)', () => {
  const config = { outputDir: null };
  expect(resolveOutputPath(undefined, makeConversation(), config)).toBeNull();
});

test('uses config.outputDir when flag is empty string', () => {
  const config = { outputDir: '/Users/test/exports' };
  const result = resolveOutputPath('', makeConversation('My Session'), config);
  expect(result).toBe('/Users/test/exports/my-session.md');
});

test('throws when flag is empty and no outputDir configured', () => {
  const config = { outputDir: null };
  expect(() => resolveOutputPath('', makeConversation(), config)).toThrow('--output requires a path');
});

test('uses trailing slash value as directory with auto-name', () => {
  const config = { outputDir: null };
  const result = resolveOutputPath('/tmp/out/', makeConversation('Cool Chat'), config);
  expect(result).toBe('/tmp/out/cool-chat.md');
});

test('uses exact path when no trailing slash', () => {
  const config = { outputDir: null };
  const result = resolveOutputPath('/tmp/my-export.md', makeConversation(), config);
  expect(result).toBe('/tmp/my-export.md');
});

test('slugifies custom title for auto-name', () => {
  const config = { outputDir: '/out' };
  const result = resolveOutputPath('', makeConversation('My Cool Session!!!'), config);
  expect(result).toBe('/out/my-cool-session.md');
});

test('falls back to session ID when no custom title', () => {
  const config = { outputDir: '/out' };
  const result = resolveOutputPath('', makeConversation(null, 'def-456-789'), config);
  expect(result).toBe('/out/def-456-789.md');
});

test('handles true as empty output flag', () => {
  const config = { outputDir: '/out' };
  const result = resolveOutputPath(true, makeConversation(null, 'sess-1'), config);
  expect(result).toBe('/out/sess-1.md');
});
