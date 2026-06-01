import { test, expect } from 'vitest';
import { resolveConfigPath, expandHome } from '../paths.js';

const HOME = '/Users/test';
const BASE = '/cfg/dir';

test('expandHome replaces a leading ~/ or bare ~, leaves ~foo alone', () => {
  expect(expandHome('~/x', HOME)).toBe('/Users/test/x');
  expect(expandHome('~', HOME)).toBe(HOME);
  expect(expandHome('~foo/x', HOME)).toBe('~foo/x');
  expect(expandHome('/abs', HOME)).toBe('/abs');
});

test('resolveConfigPath: absolute paths pass through unchanged', () => {
  expect(resolveConfigPath('/abs/path', { home: HOME, baseDir: BASE })).toBe('/abs/path');
});

test('resolveConfigPath: ~ expands to home (then absolute, no baseDir)', () => {
  expect(resolveConfigPath('~/work', { home: HOME, baseDir: BASE })).toBe('/Users/test/work');
});

test('resolveConfigPath: relative resolves against baseDir (config dir)', () => {
  expect(resolveConfigPath('./sib', { home: HOME, baseDir: BASE })).toBe('/cfg/dir/sib');
  expect(resolveConfigPath('../up', { home: HOME, baseDir: BASE })).toBe('/cfg/up');
  expect(resolveConfigPath('bare', { home: HOME, baseDir: BASE })).toBe('/cfg/dir/bare');
});

test('resolveConfigPath: canonicalize runs realpath on the resolved relative path', () => {
  const seen = [];
  const realpath = (p) => { seen.push(p); return `${p}#real`; };
  expect(resolveConfigPath('./sib', { home: HOME, baseDir: BASE, realpath, canonicalize: true }))
    .toBe('/cfg/dir/sib#real');
  expect(seen).toEqual(['/cfg/dir/sib']);
});

test('resolveConfigPath: canonicalize does NOT realpath an absolute path (mount parity)', () => {
  const realpath = () => { throw new Error('should not be called'); };
  expect(resolveConfigPath('/abs', { home: HOME, baseDir: BASE, realpath, canonicalize: true })).toBe('/abs');
});
