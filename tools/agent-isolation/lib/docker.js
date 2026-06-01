// docker.js — Construct the docker invocations (port of launch.sh's CMD).
//
// Pure command builders; execution is shelled out by the launch command
// through an injected runner. buildRunCommand mirrors launch.sh's CMD array
// element-for-element so `--dry-run` output stays equivalent.

import { IMAGE_NAME, SLACK_OAUTH_PORT, CLAUDE_CONTAINER_PATH, STATE_CONTAINER_PATH } from './constants.js';

// The command run inside the container, by mode.
function runSuffix(run) {
  switch (run.mode) {
    case 'autonomous':
      return ['claude', '-p', run.prompt, '--dangerously-skip-permissions'];
    case 'resume':
      return ['claude', '--dangerously-skip-permissions', '--continue'];
    default: // interactive — drop to bash, user runs claude manually
      return ['bash'];
  }
}

export function buildRunCommand({
  containerName,
  hostname,
  claudeDir,
  stateDir,
  volumeMounts,
  workdir,
  oauthHostPort,
  ports,
  envPairs,
  envFile,
  network,
  run,
  image = `${IMAGE_NAME}:latest`,
}) {
  const cmd = ['docker', 'run', '--name', containerName, '--hostname', hostname, '-it'];

  if (claudeDir) {
    cmd.push('-v', `${claudeDir}:${CLAUDE_CONTAINER_PATH}:rw`);
  }
  cmd.push('-v', `${stateDir}:${STATE_CONTAINER_PATH}:ro`);

  for (const { host, containerPath, dockerMode } of volumeMounts) {
    cmd.push('-v', `${host}:${containerPath}:${dockerMode}`);
  }

  cmd.push('-w', workdir);
  cmd.push('-p', `${oauthHostPort}:${SLACK_OAUTH_PORT}`);

  for (const port of ports) cmd.push('-p', port);
  // --env-file before -e: docker applies the file first, so inline -e wins.
  if (envFile) cmd.push('--env-file', envFile);
  for (const env of envPairs) cmd.push('-e', env);
  if (network) cmd.push('--network', network);

  cmd.push(image, ...runSuffix(run));
  return cmd;
}

// Matches bash `echo "${CMD[*]}"` — naive space join, no shell quoting.
export const formatCommand = (argv) => argv.join(' ');

export const execCommand = (containerName) => ['docker', 'exec', '-it', containerName, 'zsh'];
export const startCommand = (containerName) => ['docker', 'start', '-ai', containerName];
