import { test, expect, describe } from 'vitest';
import { mergeConfig } from '../config.js';

describe('mergeConfig', () => {
  test('CLI includeHosts overrides file config', () => {
    const fileConfig = { includeHosts: ['localhost:3456'], _loaded: true };
    const cliOptions = { includeHosts: 'localhost:8080' };

    const config = mergeConfig(fileConfig, cliOptions);
    expect(config.includeHosts).toEqual(['localhost:8080']);
  });

  test('uses file config when CLI has no hosts', () => {
    const fileConfig = { includeHosts: ['localhost:3456'], _loaded: true };
    const cliOptions = {};

    const config = mergeConfig(fileConfig, cliOptions);
    expect(config.includeHosts).toEqual(['localhost:3456']);
  });

  test('parses comma-separated CLI hosts', () => {
    const config = mergeConfig({ _loaded: false }, { includeHosts: 'a.com,b.com,c.com' });
    expect(config.includeHosts).toEqual(['a.com', 'b.com', 'c.com']);
  });

  test('returns no filters when nothing configured', () => {
    const config = mergeConfig({ _loaded: false }, {});
    expect(config.includeHosts).toBeUndefined();
    expect(config.excludeHosts).toBeUndefined();
  });

  test('CLI excludeHosts overrides file config', () => {
    const fileConfig = { excludeHosts: ['fonts.googleapis.com'], _loaded: true };
    const cliOptions = { excludeHosts: 'cdn.example.com' };

    const config = mergeConfig(fileConfig, cliOptions);
    expect(config.excludeHosts).toEqual(['cdn.example.com']);
  });
});
