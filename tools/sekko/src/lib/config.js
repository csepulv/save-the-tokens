import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

const CONFIG_FILENAME = 'sekko.config.yaml';

/**
 * Load config from sekko.config.yaml in CWD, merge with CLI options.
 * CLI options override config file values.
 */
export function loadConfig(cliOptions = {}) {
  const fileConfig = loadConfigFile();
  return mergeConfig(fileConfig, cliOptions);
}

export function loadConfigFile(dir = process.cwd()) {
  const configPath = resolve(dir, CONFIG_FILENAME);
  if (!existsSync(configPath)) return { _loaded: false };

  const content = readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(content) || {};
  return { ...parsed, _loaded: true, _path: configPath };
}

export function mergeConfig(fileConfig, cliOptions) {
  const config = { _loaded: fileConfig._loaded, _path: fileConfig._path };

  // includeHosts: CLI overrides file
  if (cliOptions.includeHosts) {
    config.includeHosts = parseHostList(cliOptions.includeHosts);
  } else if (fileConfig.includeHosts) {
    config.includeHosts = fileConfig.includeHosts;
  }

  // excludeHosts: CLI overrides file
  if (cliOptions.excludeHosts) {
    config.excludeHosts = parseHostList(cliOptions.excludeHosts);
  } else if (fileConfig.excludeHosts) {
    config.excludeHosts = fileConfig.excludeHosts;
  }

  return config;
}

function parseHostList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((h) => h.trim());
  return [];
}
