#!/usr/bin/env node
// init-hermes-container — build a per-container hermes deployment from one
// YAML config file. Usage: init-hermes-container <config-file>

import { writeFile as fsWriteFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadConfig as realLoadConfig } from './lib/config.js';
import { ensureWorkspace as realEnsureWorkspace } from './lib/workspace.js';
import { seedClaudeConfig as realSeedClaudeConfig } from './lib/claude-seed.js';
import { resolvePorts as realResolvePorts } from './lib/ports.js';
import { buildCompose } from './lib/compose.js';

function printSummary(log, { config, composePath, ports, seed }) {
  const claudeStatus = seed.seeded
    ? 'seeded from ~/.claude'
    : `skipped (${seed.reason})`;
  log('');
  log(`Done — ${config.containerName}`);
  log(`  workspace:   ${config.hermesWorkspace}`);
  log(`  compose:     ${composePath}`);
  const portLine = `gateway ${ports.gateway}, dashboard ${ports.dashboard}`
    + (ports.ssh ? `, ssh ${ports.ssh}` : '');
  log(`  ports:       ${portLine}`);
  log(`  claude cfg:  ${claudeStatus}`);
  log('');
  log('Next:');
  log(`  docker compose -f ${composePath} up -d`);
  log(`  docker compose -f ${composePath} exec -it gateway hermes setup`);
  log(`  dashboard: http://localhost:${ports.dashboard}`);
  if (ports.ssh) log(`  ssh:       ssh hermes@localhost -p ${ports.ssh}`);
}

export async function run(argv, deps = {}) {
  const {
    loadConfig = realLoadConfig,
    ensureWorkspace = realEnsureWorkspace,
    seedClaudeConfig = realSeedClaudeConfig,
    resolvePorts = realResolvePorts,
    writeFile = fsWriteFile,
    getUid = () => process.getuid(),
    getGid = () => process.getgid(),
    log = console.log,
  } = deps;

  const configPath = argv[2];
  if (!configPath) {
    throw new Error('usage: init-hermes-container <config-file>');
  }

  const config = await loadConfig(configPath);
  const { claudeDir } = await ensureWorkspace(config.hermesWorkspace);
  const seed = await seedClaudeConfig(claudeDir);
  const portKeys = config.ssh.enabled
    ? ['gateway', 'dashboard', 'ssh']
    : ['gateway', 'dashboard'];
  const ports = await resolvePorts(config.ports, portKeys);
  const compose = buildCompose(config, ports, { uid: getUid(), gid: getGid() });

  const composePath = `${config.hermesWorkspace}/docker-compose.yml`;
  await writeFile(composePath, yaml.dump(compose, { lineWidth: -1, noRefs: true }));

  printSummary(log, { config, composePath, ports, seed });
  return { composePath, ports };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
