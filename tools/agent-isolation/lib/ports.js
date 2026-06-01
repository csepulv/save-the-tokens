// ports.js — Slack OAuth host-port selection (port of launch.sh's loop).
//
// The container-side OAuth port is always SLACK_OAUTH_PORT (3118), matching
// settings.json's callbackPort. The host-side port auto-increments if another
// container already publishes it. Scoped to docker-published ports (what the
// bash checked via `docker ps`), not OS-level bindability.

import { execFileSync } from 'node:child_process';
import { SLACK_OAUTH_PORT } from './constants.js';

// Host ports from `docker ps --format '{{.Ports}}'` — the "0.0.0.0:PORT->" parts.
export function parsePublishedHostPorts(psOutput) {
  const ports = new Set();
  for (const match of psOutput.matchAll(/0\.0\.0\.0:(\d+)->/g)) {
    ports.add(Number(match[1]));
  }
  return ports;
}

export function resolveOauthHostPort(publishedPorts, startPort = SLACK_OAUTH_PORT) {
  let port = startPort;
  while (publishedPorts.has(port)) port += 1;
  return port;
}

// OS-level free check (catches non-docker listeners too, unlike the docker-ps
// scan above). `lsof` exits non-zero when nothing is listening on the port.
export const isPortFree = (port) => {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === '';
  } catch {
    return true;
  }
};

export function nextFreePort(start, free = isPortFree) {
  let port = start;
  while (!free(port)) port += 1;
  return port;
}

// Resolve user-declared extra ports, handling host-side conflicts
// interactively. Returns the resolved ['host:container', …] list. Throws
// (so launch can abort BEFORE starting services) when a conflict is declined.
export function resolveExtraPorts(ports, deps = {}) {
  const { free = isPortFree, prompt = () => '', log = console.log } = deps;
  return ports.map((mapping) => {
    const [host, container = host] = mapping.split(':');
    const hostPort = Number(host);
    if (free(hostPort)) return mapping;

    const candidate = nextFreePort(hostPort + 1, free);
    const answer = prompt(`Port ${hostPort} is in use — use ${candidate} instead? [y/N] `);
    if (/^[Yy]/.test(answer)) {
      log(`  port ${hostPort} → ${candidate} (host side; container still listens on ${container})`);
      return `${candidate}:${container}`;
    }
    throw new Error(`Port ${hostPort} is in use. Free it or change the config, then relaunch.`);
  });
}
