import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

const CONFIG_FILENAME = '.session-export.yaml';

export function expandTilde(filepath, home = homedir()) {
  if (filepath.startsWith('~/')) {
    return join(home, filepath.slice(2));
  }
  return filepath;
}

function buildDefaults(home) {
  return {
    outputDir: null,
    sources: { default: join(home, '.claude') },
  };
}

function normalizeConfig(raw, home) {
  const config = buildDefaults(home);

  if (raw?.outputDir) {
    config.outputDir = expandTilde(String(raw.outputDir), home);
  }

  if (raw?.sources && typeof raw.sources === 'object') {
    config.sources = {};
    for (const [name, path] of Object.entries(raw.sources)) {
      config.sources[name] = expandTilde(String(path), home);
    }
    if (!config.sources.default) {
      config.sources.default = join(home, '.claude');
    }
  }

  return config;
}

export async function loadConfig(deps = {}) {
  const { readFile: read = readFile, homedir: home = homedir, configPath: explicitPath } = deps;
  const homeDir = home();
  const configPath = explicitPath ?? join(homeDir, CONFIG_FILENAME);

  let content;
  try {
    content = await read(configPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return buildDefaults(homeDir);
    throw err;
  }

  const raw = yaml.load(content);
  return normalizeConfig(raw, homeDir);
}

export function resolveSource(nameOrPath, config) {
  if (!nameOrPath) {
    return config.sources.default;
  }

  // If it looks like a path, use as-is (tilde already expanded by config)
  if (nameOrPath.includes('/') || nameOrPath.startsWith('~')) {
    return expandTilde(nameOrPath, homedir());
  }

  // Look up alias
  if (config.sources[nameOrPath]) {
    return config.sources[nameOrPath];
  }

  // Fall back to treating as a path
  return nameOrPath;
}

export function resolveOutputPath(outputFlag, conversation, config) {
  const slug = makeSlug(conversation);

  // --output not provided → stdout
  if (outputFlag === undefined) return null;

  // --output with no value → use config.outputDir
  if (outputFlag === '' || outputFlag === true) {
    if (!config.outputDir) {
      throw new Error('--output requires a path argument, or set outputDir in ~/.session-export.yaml');
    }
    return join(config.outputDir, `${slug}.md`);
  }

  const value = String(outputFlag);

  // If it ends with / treat as directory
  if (value.endsWith('/')) {
    return join(value, `${slug}.md`);
  }

  return value;
}

export function makeSlug(conversation) {
  const title = conversation.metadata?.customTitle;
  if (title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  return conversation.metadata?.sessionId ?? 'export';
}
