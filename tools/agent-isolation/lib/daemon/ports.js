// daemon/ports.js — Resolve daemon host ports: explicit values verbatim,
// omitted ones auto-assigned to the next free port from a per-service default.
//
// Adapted from tools/hermes/lib/ports.js (M3a): same contract, but reuses
// agent-isolation's sync isPortFree/nextFreePort instead of async get-port.

import { isPortFree, nextFreePort } from '../ports.js';

const DEFAULTS = { gateway: 8642, dashboard: 9119, ssh: 2222 };

export function resolvePorts(configPorts = {}, keys = ['gateway', 'dashboard'], deps = {}) {
  const { free = isPortFree } = deps;
  const resolved = {};
  const used = new Set();

  for (const key of keys) {
    if (configPorts[key] !== undefined) {
      resolved[key] = configPorts[key];
      used.add(configPorts[key]);
    }
  }

  for (const key of keys) {
    if (resolved[key] !== undefined) continue;
    const port = nextFreePort(DEFAULTS[key], (p) => free(p) && !used.has(p));
    resolved[key] = port;
    used.add(port);
  }

  return resolved;
}
