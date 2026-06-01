// daemon/workspace.js — Ensure a daemon workspace's two config dirs exist.
// Copied from tools/hermes/lib/workspace.js (M3a), sync.

import { mkdirSync } from 'node:fs';

// Given the workspace root, create <ws>/hermes and <ws>/claude-code if absent.
// Idempotent (mkdir recursive). Returns the two resolved paths.
export function ensureWorkspace(hermesWorkspace, deps = {}) {
  const { mkdir = (p, opts) => mkdirSync(p, opts) } = deps;
  const hermesDir = `${hermesWorkspace}/hermes`;
  const claudeDir = `${hermesWorkspace}/claude-code`;
  mkdir(hermesDir, { recursive: true });
  mkdir(claudeDir, { recursive: true });
  return { hermesDir, claudeDir };
}
