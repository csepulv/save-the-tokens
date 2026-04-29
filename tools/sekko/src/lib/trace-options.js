import { resolve } from 'path';
import { resolveProfilePath, expandTilde } from './profile-paths.js';

const VIEWPORT_PATTERN = /^(\d+)x(\d+)$/;

export function parseViewport(value) {
  if (!value) return null;
  const match = value.match(VIEWPORT_PATTERN);
  if (!match) {
    throw new Error(`Invalid --viewport value "${value}". Expected format: <width>x<height> (e.g., 1920x1080)`);
  }
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid --viewport value "${value}". Width and height must be positive.`);
  }
  return { width, height };
}

export function parseExtensions(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => resolve(expandTilde(p)));
}

// 127.0.0.1, not localhost: Node 18+ resolves "localhost" to ::1 (IPv6)
// first, but Chrome's --remote-debugging-port listens on IPv4 only by
// default → connection refused. Forcing IPv4 in the default URL avoids
// the surprise.
const DEFAULT_CONNECT_URL = 'http://127.0.0.1:9222';

// resolveConnectUrl owns the connect-mode default — NOT Commander.
// `--connect [url]` is intentionally registered without a third-arg
// default in cli.js so that `options.connect === undefined` means
// "user didn't pass --connect at all" (off). Commander's value
// otherwise: `true` for `--connect` with no value, the string for
// `--connect <url>`. Adding a Commander default would make
// options.connect always truthy and break the off/on detection.
export function resolveConnectUrl(value) {
  if (value === undefined || value === null) return null;
  if (value === true || value === '') return DEFAULT_CONNECT_URL;
  // If the user passes localhost, swap to 127.0.0.1 for the same reason.
  // Preserve any port/path the user provided.
  return String(value).replace(/^(https?:\/\/)localhost(?=[:/]|$)/, '$1127.0.0.1');
}

export function planTraceLaunch(options = {}) {
  const connectUrl = resolveConnectUrl(options.connect);

  if (connectUrl) {
    const conflicts = [];
    if (options.profile) conflicts.push('--profile');
    if (options.userDataDir) conflicts.push('--user-data-dir');
    if (options.loadExtension) conflicts.push('--load-extension');
    if (options.auth) conflicts.push('--auth');
    if (options.saveAuth) conflicts.push('--save-auth');
    if (conflicts.length > 0) {
      throw new Error(
        `--connect is mutually exclusive with: ${conflicts.join(', ')}. ` +
        `When connecting to a running browser, profiles, extensions, and auth ` +
        `state belong to the connected browser, not sekko.`
      );
    }

    const viewport = options.viewport === undefined
      ? null
      : parseViewport(options.viewport);

    // Surface flags that have no effect in connect mode (the attached
    // browser owns its window/viewport, and no HAR is produced because
    // recordHar belongs to a context sekko didn't create). Same warning
    // channel used for --auth/--save-auth ignored under persistent profile.
    const warnings = [];
    if (options.viewport) {
      warnings.push(
        'Warning: --viewport is ignored in --connect mode (the attached browser owns its window/viewport).'
      );
    }
    if (options.sanitize === false) {
      warnings.push(
        'Warning: --no-sanitize has no effect in --connect mode (no HAR is produced when attaching to a running browser).'
      );
    }

    return {
      mode: 'connect',
      connectUrl,
      persistencePath: null,
      extensions: [],
      viewport,
      warnings,
      useAuth: false,
      useSaveAuth: false,
    };
  }

  const persistencePath = resolveProfilePath({
    profile: options.profile,
    userDataDir: options.userDataDir,
  });

  const extensions = parseExtensions(options.loadExtension);
  if (extensions.length > 0 && !persistencePath) {
    throw new Error(
      'Loading extensions requires a persistent profile. Pass --profile <name> or --user-data-dir <path>.'
    );
  }

  const viewport = options.viewport === undefined
    ? null
    : parseViewport(options.viewport);

  const warnings = [];
  const ignoredAuth = persistencePath && (options.auth || options.saveAuth);
  if (ignoredAuth) {
    warnings.push(
      'Warning: --auth and --save-auth are ignored when using a persistent profile (--profile or --user-data-dir).'
    );
  }

  return {
    mode: persistencePath ? 'persistent' : 'ephemeral',
    connectUrl: null,
    persistencePath,
    extensions,
    viewport,
    warnings,
    useAuth: !persistencePath && !!options.auth,
    useSaveAuth: !persistencePath && !!options.saveAuth,
  };
}
