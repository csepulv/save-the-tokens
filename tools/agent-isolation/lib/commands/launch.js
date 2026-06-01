// commands/launch.js — Run, resume, or attach to an agent container.
//
// launch() reads as an outline: resolve the config, write runtime state,
// optionally build, then dispatch by container state to one of three
// lifecycle paths — attach (running) / resume (stopped) / create (absent).
// Each path returns { action, command, dryRun, exitCode? }. Docker
// primitives are injected (resolveDeps) so the state matrix is testable.
//
// M3 seam: the always-on `mode: daemon` lifecycle (emit a docker-compose.yml)
// will branch in launch() before the interactive dispatch — see the marker.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

import { resolveConfigPath } from '../paths.js';
import { parseConfig, resolveConfigFile, readConfigMode } from '../config.js';
import { emitDaemon as realEmitDaemon } from '../daemon/emit.js';
import { buildRunCommand, formatCommand, execCommand, startCommand } from '../docker.js';
import { resolveOauthHostPort, parsePublishedHostPorts, resolveExtraPorts, isPortFree as portIsFree } from '../ports.js';
import { stateDir, writeOnStart } from '../on-start.js';
import { composeExternalNetwork, ensureServicesUp, postSession, teardownServices, agentOnNetwork } from '../services.js';
import { buildImage } from './build.js';
import { promptLine } from '../prompt.js';
import { IMAGE_NAME } from '../constants.js';

// ── Injected-docker defaults ───────────────────────────────────────
// stdio discards stderr (the bash used `2>/dev/null`) — `docker inspect`
// on an absent container prints "no such object" we don't want surfaced.
const quietStdout = { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] };

const defaultInspectState = (name) => {
  try {
    const out = execFileSync('docker', ['inspect', '--format', '{{.State.Status}}', name], quietStdout);
    return out.trim() || 'absent';
  } catch {
    return 'absent';
  }
};
const defaultPublishedPorts = () => {
  try {
    return parsePublishedHostPorts(execFileSync('docker', ['ps', '--format', '{{.Ports}}'], quietStdout));
  } catch {
    return new Set();
  }
};
const defaultImageExists = () => {
  try {
    execFileSync('docker', ['image', 'inspect', `${IMAGE_NAME}:latest`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
// Host ports an existing container is configured to publish (so resume can
// detect a now-occupied baked-in port it cannot remap).
const defaultInspectPublishedPorts = (name) => {
  try {
    const out = execFileSync('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', name], quietStdout);
    const bindings = JSON.parse(out.trim() || '{}');
    return Object.values(bindings).flatMap((list) => (list || []).map((b) => Number(b.HostPort)).filter(Boolean));
  } catch {
    return [];
  }
};

// Resolve injected deps to concrete implementations (the testing seam).
// `raw` is the original deps object, forwarded to injectable sub-functions
// (ensureServices/teardownServices/resolveNetwork/buildImage) that pull their
// own injectables from it.
function resolveDeps(deps) {
  return {
    log: deps.log ?? console.log,
    warn: deps.warn ?? ((m) => console.error(m)),
    home: deps.home ?? process.env.HOME ?? homedir(),
    dirExists: deps.dirExists ?? existsSync,
    inspectState: deps.inspectState ?? defaultInspectState,
    publishedPorts: deps.publishedPorts ?? defaultPublishedPorts,
    imageExists: deps.imageExists ?? defaultImageExists,
    inspectPublishedPorts: deps.inspectPublishedPorts ?? defaultInspectPublishedPorts,
    runDocker: deps.runDocker ?? ((argv) => execFileSync(argv[0], argv.slice(1), { stdio: 'inherit' })),
    buildFn: deps.build ?? ((o) => buildImage(o, deps)),
    resolveNetwork: deps.resolveNetwork ?? composeExternalNetwork,
    ensureServices: deps.ensureServices ?? ensureServicesUp,
    finishSession: deps.finishSession ?? postSession,
    writeState: deps.writeState ?? ((dirPath, onStart) => writeOnStart(dirPath, onStart)),
    prompt: deps.prompt ?? promptLine,
    checkNetwork: deps.checkNetwork ?? agentOnNetwork,
    isPortFree: deps.isPortFree ?? portIsFree,
    emitDaemon: deps.emitDaemon ?? realEmitDaemon,
    raw: deps,
  };
}

// Resolve the (already-located) config into the interactive launch context:
// parsed config, services/network (mutually exclusive, path-anchored),
// container identity.
function resolveLaunchConfig(configFile, opts, dep) {
  const { home } = dep;
  const cfg = parseConfig(configFile, { home });

  let servicesFile = cfg.servicesFile;
  let network = cfg.network;
  if (servicesFile && network) {
    throw new Error(`'services' and 'network' in ${configFile} are mutually exclusive.`);
  }
  if (servicesFile) {
    // Relative services paths anchor to the config file's dir.
    servicesFile = resolveConfigPath(servicesFile, { home, baseDir: dirname(configFile) });
    if (!dep.dirExists(servicesFile)) throw new Error(`Services file not found: ${servicesFile}`);
    network = dep.resolveNetwork(servicesFile, dep.raw);
  }

  if (!cfg.firstRw) throw new Error(`No rw mount in ${configFile}. At least one is required.`);

  const containerName = opts.name || cfg.containerName;
  const hostname = cfg.hostnameOverride || containerName;
  return { configFile, cfg, servicesFile, network, containerName, hostname, stateDirPath: stateDir(home, containerName) };
}

// Bundle the resolved config + flags + deps with the two shared closures
// (runMeta for finish/network-warn, bringUpServices) the lifecycle paths use.
function makeSession(base, opts, dep) {
  const { servicesFile, network, containerName } = base;
  const runMeta = {
    servicesFile, network, containerName, autonomous: Boolean(opts.autonomous),
    inspectState: dep.inspectState, finishSession: dep.finishSession, prompt: dep.prompt,
    checkNetwork: dep.checkNetwork, warn: dep.warn, log: dep.log, deps: dep.raw,
  };
  const bringUpServices = (isDry) => {
    if (!servicesFile) return;
    if (isDry) {
      dep.log(`Dry run — would start services from ${servicesFile} on ${network}`);
      return;
    }
    dep.ensureServices(servicesFile, network, dep.raw);
  };
  return { ...base, opts, dep, runMeta, bringUpServices };
}

export function launch(options = {}, deps = {}) {
  const opts = {
    configArg: options.configArg ?? '',
    name: options.name ?? '',
    autonomous: options.autonomous ?? '',
    resume: Boolean(options.resume),
    build: Boolean(options.build),
    dryRun: Boolean(options.dryRun),
  };
  const dep = resolveDeps(deps);
  const configFile = resolveConfigFile(opts.configArg, dep.raw);

  // ── M3 daemon branch ──
  // A `mode: daemon` config emits a docker-compose.yml and returns, before the
  // interactive resolve/validation (firstRw, claude-mount) — which don't apply.
  if (readConfigMode(configFile) === 'daemon') {
    return dep.emitDaemon(configFile, dep.raw);
  }

  const base = resolveLaunchConfig(configFile, opts, dep);
  dep.writeState(base.stateDirPath, base.cfg.onStart);
  if (opts.build) dep.buildFn({});

  const session = makeSession(base, opts, dep);

  const state = dep.inspectState(session.containerName);
  if (state === 'running') return attachRunning(session);
  if (state === 'exited' || state === 'created') return resumeStopped(session, state);
  if (state === 'absent') return createFresh(session);
  throw new Error(`Container ${session.containerName} is in unexpected state: ${state}. Run: docker rm ${session.containerName}`);
}

// ── Lifecycle path: attach to a running container (docker exec) ──
function attachRunning(session) {
  const { containerName, runMeta, bringUpServices, opts, dep } = session;
  const command = execCommand(containerName);
  dep.log(`Container ${containerName} is running. Attaching...`);

  if (opts.dryRun) {
    bringUpServices(true);
    dep.log(`  ${formatCommand(command)}`);
    return { action: 'attach', command, dryRun: true };
  }
  bringUpServices(false);
  warnIfWrongNetwork(runMeta);
  const exitCode = runContainer(command, dep.runDocker);
  runFinish(runMeta);
  return { action: 'attach', command, dryRun: false, exitCode };
}

// ── Lifecycle path: resume a stopped container (docker start) ──
function resumeStopped(session, state) {
  const { containerName, runMeta, bringUpServices, opts, dep } = session;
  const command = startCommand(containerName);
  dep.log(`Container ${containerName} exists (${state}). Resuming...`);

  if (opts.dryRun) {
    bringUpServices(true);
    dep.log(`  ${formatCommand(command)}`);
    return { action: 'resume', command, dryRun: true };
  }

  // Resume re-publishes the container's baked-in ports, which we cannot
  // remap on an existing container. Check before starting services and
  // explain, rather than letting `docker start` fail cryptically.
  const busy = dep.inspectPublishedPorts(containerName).filter((port) => !dep.isPortFree(port));
  if (busy.length) {
    throw new Error(
      `Container ${containerName} publishes port ${busy.join(', ')}, now in use by another process. `
      + `Free it, or \`docker rm ${containerName}\` and relaunch to pick a new port.`,
    );
  }

  bringUpServices(false);
  warnIfWrongNetwork(runMeta);
  const exitCode = runContainer(command, dep.runDocker);
  runFinish(runMeta);
  return { action: 'resume', command, dryRun: false, exitCode };
}

// ── Lifecycle path: create a fresh container (docker run) ──
function createFresh(session) {
  const { configFile, cfg, network, containerName, hostname, stateDirPath, runMeta, bringUpServices, opts, dep } = session;

  if (cfg.claudeDir && !dep.dirExists(cfg.claudeDir)) {
    throw new Error(`${cfg.claudeDir} not found. Run sync first.`);
  }
  if (!cfg.claudeDir) {
    dep.warn(`Warning: No 'claude' mount in ${configFile}. Container will use ephemeral ~/.claude.`);
  }
  if (!dep.imageExists()) {
    dep.log(`Image ${IMAGE_NAME}:latest not found. Building...`);
    dep.buildFn({});
  }

  const oauthHostPort = resolveOauthHostPort(dep.publishedPorts());
  const run = opts.autonomous
    ? { mode: 'autonomous', prompt: opts.autonomous }
    : opts.resume ? { mode: 'resume' } : { mode: 'interactive' };
  const makeCommand = (ports) => buildRunCommand({
    containerName,
    hostname,
    claudeDir: cfg.claudeDir,
    stateDir: stateDirPath,
    volumeMounts: cfg.volumeMounts,
    workdir: cfg.firstRw.containerPath,
    oauthHostPort,
    ports,
    envPairs: cfg.envPairs,
    envFile: cfg.envFile,
    network,
    run,
  });

  if (opts.dryRun) {
    bringUpServices(true);
    const command = makeCommand(cfg.ports);
    dep.log('Dry run — would execute:');
    dep.log(`  ${formatCommand(command)}`);
    return { action: 'create', command, dryRun: true };
  }

  // Resolve host-port conflicts BEFORE starting services, so an aborted
  // launch never leaves services half-started.
  const ports = resolveExtraPorts(cfg.ports, { free: dep.isPortFree, prompt: dep.prompt, log: dep.log });
  const command = makeCommand(ports);

  bringUpServices(false);
  const exitCode = runContainer(command, dep.runDocker);
  runFinish(runMeta);
  return { action: 'create', command, dryRun: false, exitCode };
}

// ── Shared helpers ──

// Run the container to completion and return its exit code. A non-zero exit
// is a NORMAL session end (the user's shell or agent exited non-zero) — not a
// launch failure. Mirrors bash `"${CMD[@]}" || RUN_EXIT=$?`.
function runContainer(command, runDocker) {
  try {
    runDocker(command);
    return 0;
  } catch (error) {
    return typeof error.status === 'number' ? error.status : 1;
  }
}

// Mirrors launch.sh's warn_if_wrong_network: before re-entering an existing
// container, warn if it isn't attached to the configured services network.
function warnIfWrongNetwork({ network, containerName, checkNetwork, warn, deps }) {
  if (!network) return;
  if (!checkNetwork(containerName, network, deps)) {
    warn(`Warning: ${containerName} is not on network '${network}'.`);
    warn('  Services will be unreachable from it. To fix, recreate it:');
    warn(`    docker rm ${containerName}   # then relaunch`);
  }
}

// finish_session: decide service teardown based on the post-run state.
function runFinish({ servicesFile, network, autonomous, containerName, inspectState, finishSession, prompt, deps }) {
  const agentRunning = inspectState(containerName) === 'running';
  finishSession(
    { servicesFile, network, agentRunning, autonomous },
    { ...deps, prompt, teardown: (f) => teardownServices(f, deps) },
  );
}
