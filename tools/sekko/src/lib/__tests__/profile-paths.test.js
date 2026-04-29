import { test, expect, describe, vi } from 'vitest';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  getProfilesRoot,
  validateProfileName,
  expandTilde,
  resolveProfilePath,
  listProfiles,
  removeProfile,
} from '../profile-paths.js';

describe('getProfilesRoot', () => {
  test('returns ~/.sekko/profiles', () => {
    expect(getProfilesRoot()).toBe(join(homedir(), '.sekko', 'profiles'));
  });
});

describe('validateProfileName', () => {
  test('accepts valid names', () => {
    expect(() => validateProfileName('default')).not.toThrow();
    expect(() => validateProfileName('ext-dev')).not.toThrow();
    expect(() => validateProfileName('client_x')).not.toThrow();
    expect(() => validateProfileName('a1b2c3')).not.toThrow();
    expect(() => validateProfileName('1starts-with-digit')).not.toThrow();
  });

  test('rejects empty', () => {
    expect(() => validateProfileName('')).toThrow(/required/);
    expect(() => validateProfileName(undefined)).toThrow(/required/);
    expect(() => validateProfileName(null)).toThrow(/required/);
  });

  test('rejects uppercase', () => {
    expect(() => validateProfileName('Default')).toThrow(/Invalid profile name/);
    expect(() => validateProfileName('FOO')).toThrow(/Invalid profile name/);
  });

  test('rejects path traversal and dots', () => {
    expect(() => validateProfileName('..')).toThrow(/Invalid profile name/);
    expect(() => validateProfileName('../etc')).toThrow(/Invalid profile name/);
    expect(() => validateProfileName('a.b')).toThrow(/Invalid profile name/);
    expect(() => validateProfileName('a/b')).toThrow(/Invalid profile name/);
  });

  test('rejects leading dash or underscore', () => {
    expect(() => validateProfileName('-leading')).toThrow(/Invalid profile name/);
    expect(() => validateProfileName('_leading')).toThrow(/Invalid profile name/);
  });

  test('rejects spaces', () => {
    expect(() => validateProfileName('with space')).toThrow(/Invalid profile name/);
  });
});

describe('expandTilde', () => {
  test('expands lone tilde', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  test('expands ~/path', () => {
    expect(expandTilde('~/foo')).toBe(join(homedir(), 'foo'));
  });

  test('passes through paths without tilde', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path');
    expect(expandTilde('rel/path')).toBe('rel/path');
  });

  test('does not expand mid-string tilde', () => {
    expect(expandTilde('/foo/~/bar')).toBe('/foo/~/bar');
  });
});

describe('resolveProfilePath', () => {
  test('returns null when neither flag set', () => {
    expect(resolveProfilePath({})).toBe(null);
    expect(resolveProfilePath()).toBe(null);
  });

  test('resolves --profile to ~/.sekko/profiles/<name>', () => {
    expect(resolveProfilePath({ profile: 'ext-dev' }))
      .toBe(join(homedir(), '.sekko', 'profiles', 'ext-dev'));
  });

  test('resolves --user-data-dir absolute path', () => {
    expect(resolveProfilePath({ userDataDir: '/tmp/test' })).toBe('/tmp/test');
  });

  test('resolves --user-data-dir relative path to absolute', () => {
    expect(resolveProfilePath({ userDataDir: 'rel/path' })).toBe(resolve('rel/path'));
  });

  test('expands tilde in --user-data-dir', () => {
    expect(resolveProfilePath({ userDataDir: '~/custom-profile' }))
      .toBe(join(homedir(), 'custom-profile'));
  });

  test('rejects when both flags set', () => {
    expect(() => resolveProfilePath({ profile: 'foo', userDataDir: '/tmp/x' }))
      .toThrow(/either --profile or --user-data-dir/);
  });

  test('rejects invalid profile name', () => {
    expect(() => resolveProfilePath({ profile: '../escape' }))
      .toThrow(/Invalid profile name/);
  });
});

function makeListDeps({ entries, statResults = {} }) {
  return {
    readdir: vi.fn().mockResolvedValue(entries),
    stat: vi.fn(async (path) => {
      if (statResults[path]) return statResults[path];
      return { mtime: new Date('2026-04-28T00:00:00Z') };
    }),
  };
}

function dirent(name, isDir = true) {
  return { name, isDirectory: () => isDir };
}

describe('listProfiles', () => {
  test('returns empty when profiles root does not exist', async () => {
    const deps = {
      readdir: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' })),
      stat: vi.fn(),
    };
    const profiles = await listProfiles(deps);
    expect(profiles).toEqual([]);
  });

  test('returns profile dirs sorted by name', async () => {
    const deps = makeListDeps({
      entries: [dirent('zeta'), dirent('alpha'), dirent('mid')],
    });
    const profiles = await listProfiles(deps);
    expect(profiles.map((p) => p.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  test('skips files (non-directories)', async () => {
    const deps = makeListDeps({
      entries: [dirent('real-profile'), dirent('stray.txt', false)],
    });
    const profiles = await listProfiles(deps);
    expect(profiles.map((p) => p.name)).toEqual(['real-profile']);
  });

  test('skips entries with invalid profile names', async () => {
    const deps = makeListDeps({
      entries: [dirent('valid'), dirent('Invalid'), dirent('.hidden')],
    });
    const profiles = await listProfiles(deps);
    expect(profiles.map((p) => p.name)).toEqual(['valid']);
  });

  test('includes path and mtime for each profile', async () => {
    const deps = makeListDeps({ entries: [dirent('foo')] });
    const profiles = await listProfiles(deps);
    expect(profiles[0].path).toContain('.sekko/profiles/foo');
    expect(profiles[0].mtime).toBeInstanceOf(Date);
  });

  test('rethrows non-ENOENT readdir errors', async () => {
    const deps = {
      readdir: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'EACCES' })),
      stat: vi.fn(),
    };
    await expect(listProfiles(deps)).rejects.toThrow(/boom/);
  });
});

describe('removeProfile', () => {
  test('removes existing profile', async () => {
    const deps = {
      stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
      rm: vi.fn().mockResolvedValue(undefined),
    };
    const path = await removeProfile('foo', deps);
    expect(path).toBe(join(homedir(), '.sekko', 'profiles', 'foo'));
    expect(deps.rm).toHaveBeenCalledWith(path, { recursive: true, force: true });
  });

  test('throws PROFILE_NOT_FOUND when profile missing', async () => {
    const deps = {
      stat: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' })),
      rm: vi.fn(),
    };
    await expect(removeProfile('missing', deps)).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
    });
    expect(deps.rm).not.toHaveBeenCalled();
  });

  test('rejects invalid profile name without touching filesystem', async () => {
    const deps = { stat: vi.fn(), rm: vi.fn() };
    await expect(removeProfile('../escape', deps)).rejects.toThrow(/Invalid profile name/);
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.rm).not.toHaveBeenCalled();
  });
});
