// commands/build.js — Build the agent Docker image (port of build-image.sh).
//
// Passes host UID/GID/user so bind-mount files get the right ownership.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { IMAGE_NAME, DAEMON_IMAGE_REF, AGENT_USER } from '../constants.js';

const TOOL_DIR = fileURLToPath(new URL('../../', import.meta.url));
const DAEMON_DIR = join(TOOL_DIR, 'daemon-image');

const defaultRun = (argv) => execFileSync(argv[0], argv.slice(1), { stdio: 'inherit' });

export function buildImage(options = {}, deps = {}) {
  const { noCache = false } = options;
  const {
    run = defaultRun,
    uid = process.getuid(),
    gid = process.getgid(),
    log = console.log,
    toolDir = TOOL_DIR,
  } = deps;

  log(`Building ${IMAGE_NAME}:latest (UID=${uid}, GID=${gid})...`);
  const args = [
    'docker', 'build',
    '--build-arg', `AGENT_UID=${uid}`,
    '--build-arg', `AGENT_GID=${gid}`,
    '--build-arg', `AGENT_USER=${AGENT_USER}`,
    ...(noCache ? ['--no-cache'] : []),
    '-t', `${IMAGE_NAME}:latest`,
    toolDir,
  ];
  run(args);
}

// Build the daemon (hermes-style) image from daemon-image/Dockerfile. No
// UID/GID build args — the hermes image handles UID at runtime via HERMES_UID.
export function buildDaemonImage(options = {}, deps = {}) {
  const { noCache = false } = options;
  const { run = defaultRun, log = console.log, daemonDir = DAEMON_DIR } = deps;

  log(`Building ${DAEMON_IMAGE_REF} (daemon image; base pinned by digest)...`);
  const args = [
    'docker', 'build',
    '-f', join(daemonDir, 'Dockerfile'),
    ...(noCache ? ['--no-cache'] : []),
    '-t', DAEMON_IMAGE_REF,
    daemonDir,
  ];
  run(args);
}
