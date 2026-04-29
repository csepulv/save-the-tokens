import { test, expect, describe, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { profileList, profileRm } from '../profile.js';

function dirent(name) {
  return { name, isDirectory: () => true };
}

describe('profileList', () => {
  test('prints "no profiles" when empty', async () => {
    const log = vi.fn();
    await profileList(undefined, {
      log,
      readdir: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' })),
      stat: vi.fn(),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No profiles in'));
  });

  test('prints each profile name and path', async () => {
    const log = vi.fn();
    await profileList(undefined, {
      log,
      readdir: vi.fn().mockResolvedValue([dirent('alpha'), dirent('beta')]),
      stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
    });
    const output = log.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output).toContain('.sekko/profiles/alpha');
    expect(output).toContain('.sekko/profiles/beta');
  });
});

describe('profileRm', () => {
  test('removes existing profile and prints confirmation', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    await profileRm('foo', undefined, {
      log,
      error,
      exit,
      stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
      rm: vi.fn().mockResolvedValue(undefined),
    });
    const expected = join(homedir(), '.sekko', 'profiles', 'foo');
    expect(log).toHaveBeenCalledWith(`Removed profile: ${expected}`);
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  test('errors and exits 1 when profile missing', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    await profileRm('missing', undefined, {
      log,
      error,
      exit,
      stat: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' })),
      rm: vi.fn(),
    });
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/not found/));
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).not.toHaveBeenCalled();
  });

  test('errors and exits 1 on invalid profile name', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    await profileRm('../escape', undefined, {
      log,
      error,
      exit,
      stat: vi.fn(),
      rm: vi.fn(),
    });
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Invalid profile name/));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
