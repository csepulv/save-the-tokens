// on-start.js — Per-container runtime state (port of launch.sh's on-start block).
//
// The on_start block is written to a host-side state dir, bind-mounted RO
// at ~/.agent-isolation/ in the container. Refreshed on every launch (fresh
// + resume) so YAML edits take effect without a `docker rm`. Kept outside
// the persistent claude config dir so agent-isolation runtime droppings
// don't accumulate in claude's state.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const stateDir = (home, containerName) =>
  join(home, '.agent-isolation', 'state', containerName);

export function writeOnStart(stateDirPath, onStart, deps = {}) {
  const {
    mkdir = (d) => mkdirSync(d, { recursive: true }),
    writeFile = (f, c) => writeFileSync(f, c),
    remove = (f) => rmSync(f, { force: true }),
  } = deps;

  mkdir(stateDirPath);
  const file = join(stateDirPath, 'on-start.json');
  if (onStart) {
    writeFile(file, `${JSON.stringify(onStart)}\n`);
  } else {
    remove(file);
  }
}
