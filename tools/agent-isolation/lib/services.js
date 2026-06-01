// services.js — Service-container orchestration (port of services.sh).
//
// Pure helpers (project name, external-network extraction) plus injectable
// orchestration that shells out to docker/docker-compose. The compose file
// is the single source of truth for the network name — the agent joins
// whatever 'external' network the services file declares.

import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const SUFFIXES = ['.services.compose.yml', '.compose.yml', '.yml', '.yaml'];

// jd.services.compose.yml → agent-svc-jd  (sequential suffix strip, like bash).
export function servicesProjectName(file) {
  let base = basename(file);
  for (const suffix of SUFFIXES) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  }
  return `agent-svc-${base}`;
}

// The single external network declared in a parsed compose config.
// Throws on zero or more than one — the agent must join exactly one.
export function externalNetworkFromConfig(config) {
  const external = Object.entries(config.networks || {})
    .filter(([, value]) => value && value.external === true)
    .map(([key]) => key);
  if (external.length === 0) {
    throw new Error("Compose file declares no external network. Add a 'networks:' entry marked 'external: true'.");
  }
  if (external.length > 1) {
    throw new Error(`Compose file declares ${external.length} external networks; expected exactly 1. Found: ${external.join(' ')}`);
  }
  return external[0];
}

const defaultRun = (argv) => execFileSync(argv[0], argv.slice(1), { stdio: 'inherit' });
const defaultNetworkExists = (network) => {
  try {
    execFileSync('docker', ['network', 'inspect', network], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// Read + parse the external network name from a compose file via docker.
export function composeExternalNetwork(servicesFile, deps = {}) {
  const { readConfig = (f) => execFileSync('docker', ['compose', '-f', f, 'config', '--format', 'json'], { encoding: 'utf-8' }) } = deps;
  return externalNetworkFromConfig(JSON.parse(readConfig(servicesFile)));
}

const defaultInspectNetworks = (name) => {
  try {
    const out = execFileSync(
      'docker',
      ['inspect', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', name],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
};

// Is container `name` attached to docker network `network`?
export function agentOnNetwork(name, network, deps = {}) {
  const { inspectNetworks = defaultInspectNetworks } = deps;
  return inspectNetworks(name).includes(network);
}

export function ensureNetwork(network, deps = {}) {
  const { networkExists = defaultNetworkExists, run = defaultRun, log = console.log } = deps;
  if (!networkExists(network)) {
    run(['docker', 'network', 'create', network]);
    log(`Created network: ${network}`);
  }
}

export function ensureServicesUp(servicesFile, network, deps = {}) {
  const { run = defaultRun, log = console.log } = deps;
  const project = servicesProjectName(servicesFile);
  ensureNetwork(network, deps);
  log(`Starting services: ${servicesFile} (project ${project})`);
  run(['docker', 'compose', '-p', project, '-f', servicesFile, 'up', '-d', '--wait']);
  log('Services ready.');
}

export function teardownServices(servicesFile, deps = {}) {
  const { run = defaultRun, log = console.log } = deps;
  const project = servicesProjectName(servicesFile);
  log(`Stopping services: ${servicesFile}`);
  run(['docker', 'compose', '-p', project, '-f', servicesFile, 'down']);
}

// Decide whether to tear down services after a session ends.
//   Mode B (no services file) → leave running, unchanged.
//   Agent still running (attach path) → services in use, leave them.
//   Autonomous → never block on a prompt.
//   Interactive → prompt; bare Enter defaults to teardown.
export function postSession({ servicesFile, network, agentRunning, autonomous }, deps = {}) {
  const { prompt = () => '', log = console.log } = deps;
  const teardown = deps.teardown || ((file) => teardownServices(file, deps));

  if (!servicesFile) {
    if (network) log(`\nServices on network '${network}' left running and unchanged.`);
    return;
  }
  if (agentRunning) {
    log('\nAgent container still running; services left untouched.');
    return;
  }

  const hint = `Stop them with: docker compose -p ${servicesProjectName(servicesFile)} -f ${servicesFile} down`;
  if (autonomous) {
    log(`\nServices left running. ${hint}`);
    return;
  }

  const answer = prompt('Stop the services started this session? [Y/n] ');
  if (answer === '' || /^[Yy]/.test(answer)) {
    teardown(servicesFile);
  } else {
    log(`Services left running. ${hint}`);
  }
}
