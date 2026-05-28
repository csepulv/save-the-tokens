// Resolve container host ports: explicit values are used verbatim; omitted
// ones are auto-assigned to the next free port from a per-service range.

import getPort, { portNumbers } from 'get-port';

// Starting port for each service's auto-assignment range.
const DEFAULTS = { gateway: 8642, dashboard: 9119, ssh: 2222 };
const RANGE = 100;

export async function resolvePorts(configPorts = {}, keys = ['gateway', 'dashboard'], deps = {}) {
  const { findPort = getPort } = deps;
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
    const start = DEFAULTS[key];
    const port = await findPort({
      port: portNumbers(start, start + RANGE),
      exclude: [...used],
    });
    resolved[key] = port;
    used.add(port);
  }

  return resolved;
}
