import { test, expect, describe } from 'vitest';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { parseViewport, parseExtensions, planTraceLaunch } from '../trace-options.js';

describe('parseViewport', () => {
  test('returns null for falsy', () => {
    expect(parseViewport(undefined)).toBe(null);
    expect(parseViewport(null)).toBe(null);
    expect(parseViewport('')).toBe(null);
  });

  test('parses WxH', () => {
    expect(parseViewport('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseViewport('800x600')).toEqual({ width: 800, height: 600 });
  });

  test('rejects malformed values', () => {
    expect(() => parseViewport('1920')).toThrow(/Invalid --viewport/);
    expect(() => parseViewport('1920X1080')).toThrow(/Invalid --viewport/);
    expect(() => parseViewport('1920x')).toThrow(/Invalid --viewport/);
    expect(() => parseViewport('axb')).toThrow(/Invalid --viewport/);
  });

  test('rejects zero or negative dimensions', () => {
    expect(() => parseViewport('0x600')).toThrow(/positive/);
    expect(() => parseViewport('800x0')).toThrow(/positive/);
  });
});

describe('parseExtensions', () => {
  test('returns empty for falsy', () => {
    expect(parseExtensions(undefined)).toEqual([]);
    expect(parseExtensions('')).toEqual([]);
  });

  test('resolves single absolute path', () => {
    expect(parseExtensions('/abs/path/ext')).toEqual(['/abs/path/ext']);
  });

  test('resolves comma-separated list', () => {
    expect(parseExtensions('/a/ext1,/b/ext2'))
      .toEqual(['/a/ext1', '/b/ext2']);
  });

  test('expands tilde and resolves to absolute', () => {
    const out = parseExtensions('~/my-ext');
    expect(out).toEqual([join(homedir(), 'my-ext')]);
  });

  test('resolves relative paths against cwd', () => {
    const out = parseExtensions('rel/ext');
    expect(out).toEqual([resolve('rel/ext')]);
  });

  test('trims whitespace and skips empty entries', () => {
    expect(parseExtensions('/a, /b , ,'))
      .toEqual(['/a', '/b']);
  });
});

describe('planTraceLaunch', () => {
  test('default: no persistence, no extensions, no viewport', () => {
    const plan = planTraceLaunch({});
    expect(plan).toEqual({
      mode: 'ephemeral',
      connectUrl: null,
      persistencePath: null,
      extensions: [],
      viewport: null,
      warnings: [],
      useAuth: false,
      useSaveAuth: false,
      useSystemScreenshots: false,
      traceExtensions: false,
    });
  });

  test('--profile resolves to ~/.sekko/profiles/<name>', () => {
    const plan = planTraceLaunch({ profile: 'ext-dev' });
    expect(plan.persistencePath).toBe(join(homedir(), '.sekko', 'profiles', 'ext-dev'));
  });

  test('--user-data-dir resolves to absolute path', () => {
    const plan = planTraceLaunch({ userDataDir: '/tmp/x' });
    expect(plan.persistencePath).toBe('/tmp/x');
  });

  test('--load-extension without profile throws', () => {
    expect(() => planTraceLaunch({ loadExtension: '/some/ext' }))
      .toThrow(/persistent profile/);
  });

  test('--load-extension with profile is fine', () => {
    const plan = planTraceLaunch({ profile: 'ext-dev', loadExtension: '/some/ext' });
    expect(plan.extensions).toEqual(['/some/ext']);
    expect(plan.persistencePath).toContain('ext-dev');
  });

  test('--auth with persistent profile produces warning, useAuth false', () => {
    const plan = planTraceLaunch({ profile: 'foo', auth: '/auth.json' });
    expect(plan.useAuth).toBe(false);
    expect(plan.warnings).toEqual([expect.stringMatching(/--auth.*ignored/)]);
  });

  test('--save-auth with persistent profile produces warning, useSaveAuth false', () => {
    const plan = planTraceLaunch({ profile: 'foo', saveAuth: '/auth.json' });
    expect(plan.useSaveAuth).toBe(false);
    expect(plan.warnings).toEqual([expect.stringMatching(/--save-auth.*ignored|--auth.*ignored/)]);
  });

  test('--auth without persistence: useAuth true, no warning', () => {
    const plan = planTraceLaunch({ auth: '/auth.json' });
    expect(plan.useAuth).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  test('--viewport WxH parsed', () => {
    const plan = planTraceLaunch({ viewport: '1920x1080' });
    expect(plan.viewport).toEqual({ width: 1920, height: 1080 });
  });

  test('rejects both --profile and --user-data-dir', () => {
    expect(() => planTraceLaunch({ profile: 'foo', userDataDir: '/tmp' }))
      .toThrow(/either --profile or --user-data-dir/);
  });

  test('default mode is ephemeral', () => {
    expect(planTraceLaunch({}).mode).toBe('ephemeral');
  });

  test('persistent mode when --profile set', () => {
    expect(planTraceLaunch({ profile: 'foo' }).mode).toBe('persistent');
  });
});

describe('planTraceLaunch — connect mode', () => {
  test('--connect with explicit URL', () => {
    const plan = planTraceLaunch({ connect: 'http://127.0.0.1:9333' });
    expect(plan.mode).toBe('connect');
    expect(plan.connectUrl).toBe('http://127.0.0.1:9333');
    expect(plan.persistencePath).toBe(null);
  });

  test('--connect with no value uses default 127.0.0.1 URL (IPv4)', () => {
    expect(planTraceLaunch({ connect: true }).connectUrl).toBe('http://127.0.0.1:9222');
    expect(planTraceLaunch({ connect: '' }).connectUrl).toBe('http://127.0.0.1:9222');
  });

  test('--connect rewrites localhost to 127.0.0.1 to avoid IPv6 surprise', () => {
    // Node 18+ resolves "localhost" to ::1 first; Chrome's debug port
    // listens on IPv4 only.
    expect(planTraceLaunch({ connect: 'http://localhost:9333' }).connectUrl)
      .toBe('http://127.0.0.1:9333');
    expect(planTraceLaunch({ connect: 'https://localhost/path' }).connectUrl)
      .toBe('https://127.0.0.1/path');
  });

  test('--connect leaves non-localhost hosts alone', () => {
    expect(planTraceLaunch({ connect: 'http://10.0.0.5:9222' }).connectUrl)
      .toBe('http://10.0.0.5:9222');
  });

  test('--connect mutually exclusive with --profile', () => {
    expect(() => planTraceLaunch({ connect: true, profile: 'foo' }))
      .toThrow(/mutually exclusive.*--profile/);
  });

  test('--connect mutually exclusive with --user-data-dir', () => {
    expect(() => planTraceLaunch({ connect: true, userDataDir: '/tmp/x' }))
      .toThrow(/mutually exclusive.*--user-data-dir/);
  });

  test('--connect mutually exclusive with --load-extension', () => {
    expect(() => planTraceLaunch({ connect: true, loadExtension: '/some/ext' }))
      .toThrow(/mutually exclusive.*--load-extension/);
  });

  test('--connect mutually exclusive with --auth', () => {
    expect(() => planTraceLaunch({ connect: true, auth: '/a.json' }))
      .toThrow(/mutually exclusive.*--auth/);
  });

  test('--connect mutually exclusive with --save-auth', () => {
    expect(() => planTraceLaunch({ connect: true, saveAuth: '/a.json' }))
      .toThrow(/mutually exclusive.*--save-auth/);
  });

  test('--connect lists all conflicts when multiple present', () => {
    expect(() => planTraceLaunch({
      connect: true,
      profile: 'foo',
      auth: '/a.json',
    })).toThrow(/--profile.*--auth/);
  });

  test('--connect parses --viewport but warns it is ignored', () => {
    // The attached browser owns its window; sekko doesn't pass viewport
    // to the existing context. Plan still parses for shape consistency.
    const plan = planTraceLaunch({ connect: true, viewport: '1920x1080' });
    expect(plan.viewport).toEqual({ width: 1920, height: 1080 });
    expect(plan.warnings).toEqual([expect.stringMatching(/--viewport.*ignored/)]);
  });

  test('--connect + --no-sanitize warns it has no effect', () => {
    // Commander's --no-sanitize sets options.sanitize === false.
    const plan = planTraceLaunch({ connect: true, sanitize: false });
    expect(plan.warnings).toEqual([expect.stringMatching(/--no-sanitize.*no effect/)]);
  });

  test('--connect + sanitize default (true) emits no sanitize warning', () => {
    const plan = planTraceLaunch({ connect: true, sanitize: true });
    expect(plan.warnings).toEqual([]);
  });

  test('--connect with both --viewport and --no-sanitize emits both warnings', () => {
    const plan = planTraceLaunch({ connect: true, viewport: '1024x768', sanitize: false });
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toMatch(/--viewport.*ignored/);
    expect(plan.warnings[1]).toMatch(/--no-sanitize.*no effect/);
  });
});

describe('planTraceLaunch — --trace-extensions preset', () => {
  test('--trace-extensions without source throws with helpful message', () => {
    expect(() => planTraceLaunch({ traceExtensions: true }))
      .toThrow(/--trace-extensions requires either --load-extension.*or --connect/);
  });

  test('--trace-extensions with --load-extension + --profile is valid', () => {
    const plan = planTraceLaunch({
      traceExtensions: true,
      loadExtension: '/some/ext',
      profile: 'ext-dev',
    });
    expect(plan.traceExtensions).toBe(true);
    expect(plan.useSystemScreenshots).toBe(true); // implicit
    expect(plan.extensions).toEqual(['/some/ext']);
  });

  test('--trace-extensions with --connect is valid', () => {
    const plan = planTraceLaunch({ traceExtensions: true, connect: true });
    expect(plan.traceExtensions).toBe(true);
    expect(plan.useSystemScreenshots).toBe(true);
    expect(plan.mode).toBe('connect');
  });

  test('--trace-extensions implies --system-screenshots', () => {
    // Even without explicit --system-screenshots, the preset enables it.
    const plan = planTraceLaunch({ traceExtensions: true, connect: true });
    expect(plan.useSystemScreenshots).toBe(true);
  });

  test('--system-screenshots without --trace-extensions still works', () => {
    const plan = planTraceLaunch({ systemScreenshots: true });
    expect(plan.useSystemScreenshots).toBe(true);
    expect(plan.traceExtensions).toBe(false);
  });

  test('plan exposes traceExtensions: false when flag not set', () => {
    const plan = planTraceLaunch({});
    expect(plan.traceExtensions).toBe(false);
    expect(plan.useSystemScreenshots).toBe(false);
  });
});
