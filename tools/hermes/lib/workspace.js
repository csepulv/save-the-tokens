// Ensure a hermes-workspace's two config directories exist.

import { mkdir as fsMkdir } from 'node:fs/promises';

// Given the workspace root, create <ws>/hermes and <ws>/claude-code if absent.
// Idempotent (mkdir recursive). Returns the two resolved paths.
export async function ensureWorkspace(hermesWorkspace, deps = {}) {
  const { mkdir = fsMkdir } = deps;
  const hermesDir = `${hermesWorkspace}/hermes`;
  const claudeDir = `${hermesWorkspace}/claude-code`;
  await mkdir(hermesDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  return { hermesDir, claudeDir };
}
