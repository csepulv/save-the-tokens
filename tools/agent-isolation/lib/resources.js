// resources.js — Normalize the optional `resources:` block (CPU + memory caps),
// shared by both config modes so they can't disagree on the schema.
//
//   resources:
//     cpus: 2        # docker `--cpus` / compose deploy.resources.limits.cpus
//     memory: 4g     # docker `--memory` / compose deploy.resources.limits.memory
//
// Returns { cpus?, memory? } with at least one set, or null when absent.

// Docker/compose memory size: digits (+ optional decimal), optional k/m/g/t/p
// unit, optional trailing b. Matches go-units RAMInBytes (512m, 4g, 1.5g, 1024).
const MEMORY_RE = /^\d+(\.\d+)?\s*[kmgtp]?b?$/i;

export function normalizeResources(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config: `resources` must be a mapping');
  }

  const result = {};

  if (raw.cpus !== undefined) {
    const { cpus } = raw;
    if (typeof cpus !== 'number' || !Number.isFinite(cpus) || cpus <= 0) {
      throw new Error('config: `resources.cpus` must be a positive number (e.g. 2 or 0.5)');
    }
    result.cpus = cpus;
  }

  if (raw.memory !== undefined) {
    const memory = typeof raw.memory === 'number' ? String(raw.memory) : raw.memory;
    if (typeof memory !== 'string' || !MEMORY_RE.test(memory.trim())) {
      throw new Error('config: `resources.memory` must be a size like 512m, 4g, or a byte count');
    }
    result.memory = memory.trim();
  }

  if (result.cpus === undefined && result.memory === undefined) {
    throw new Error('config: `resources` must set at least one of `cpus` or `memory`');
  }
  return result;
}
