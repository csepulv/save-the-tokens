// daemon/emit.js — Emit a daemon (hermes-style) container's docker-compose.yml
// from one agent.yml (mode: daemon). The daemon counterpart to the interactive
// `docker run` path: load config → ensure workspace → seed claude config →
// resolve ports → build compose → write <ws>/docker-compose.yml → print next
// steps. No container is created (M3a is emit-only; standing up is M3b).
//
// Ported from tools/hermes/init-hermes-container.js (M3a), sync + DI seam.

import { writeFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { loadConfig as realLoadConfig } from './config.js';
import { ensureWorkspace as realEnsureWorkspace } from './workspace.js';
import { seedClaudeConfig as realSeedClaudeConfig } from './claude-seed.js';
import { resolvePorts as realResolvePorts } from './ports.js';
import { buildCompose as realBuildCompose } from './compose.js';

function printSummary(log, { config, composePath, ports, seed }) {
  const claudeStatus = seed.seeded ? 'seeded from ~/.claude' : `skipped (${seed.reason})`;
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
  // `--build` when the config extends the base image per-container (build:).
  const up = config.build ? 'up -d --build' : 'up -d';
  log(`  docker compose -f ${composePath} ${up}`);
  log(`  docker compose -f ${composePath} exec -it hermes hermes setup`);
  log(`  dashboard: http://localhost:${ports.dashboard}`);
  if (ports.ssh) log(`  ssh:       ssh hermes@localhost -p ${ports.ssh}`);
}

export function emitDaemon(configFile, deps = {}) {
  const {
    loadConfig = realLoadConfig,
    ensureWorkspace = realEnsureWorkspace,
    seedClaudeConfig = realSeedClaudeConfig,
    resolvePorts = realResolvePorts,
    buildCompose = realBuildCompose,
    writeFile = (p, c) => writeFileSync(p, c),
    fileExists = (p) => existsSync(p),
    getUid = () => process.getuid(),
    getGid = () => process.getgid(),
    log = console.log,
  } = deps;

  const config = loadConfig(configFile);
  // Fail loudly if the (resolved, absolute) Dockerfile is missing — a `docker
  // compose --build` would otherwise fail with a confusing context error.
  if (config.build && !fileExists(config.build.dockerfile)) {
    throw new Error(`config: build.dockerfile not found: ${config.build.dockerfile}`);
  }
  const { claudeDir } = ensureWorkspace(config.hermesWorkspace);
  const seed = seedClaudeConfig(claudeDir);
  const portKeys = config.ssh.enabled
    ? ['gateway', 'dashboard', 'ssh']
    : ['gateway', 'dashboard'];
  const ports = resolvePorts(config.ports, portKeys);
  const compose = buildCompose(config, ports, { uid: getUid(), gid: getGid() });

  const composePath = `${config.hermesWorkspace}/docker-compose.yml`;
  writeFile(composePath, yaml.dump(compose, { lineWidth: -1, noRefs: true }));

  printSummary(log, { config, composePath, ports, seed });
  return { action: 'daemon', composePath, ports };
}
