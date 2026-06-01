// daemon/compose.js — Build the docker-compose.yml object for one daemon
// (hermes-style) container.
//
// Modernized for the s6-overlay base (M3b): ONE service. The new base runs the
// container CMD (`gateway run`) as /init's main program, and runs the dashboard
// as an s6 service when HERMES_DASHBOARD is set — so gateway + dashboard live in
// a single container (hermes' old image used two). sshd starts via an s6
// cont-init hook (see daemon-image/). HERMES_DASHBOARD_INSECURE replaces the
// old `--insecure` command flag.

import { dirname, relative } from 'node:path';
import { DAEMON_IMAGE_REF } from '../constants.js';

const IMAGE = DAEMON_IMAGE_REF;

// A `build:` config extends the base image per-container (FROM the base + extra
// tools). Emit a compose build block (context defaults to the Dockerfile's dir;
// dockerfile is expressed relative to context, as compose expects) and tag the
// result `<container>:local` so it's named. Absent → the prebuilt base image.
function imageOrBuild(config, containerName) {
  if (!config.build) return { image: IMAGE };
  const { dockerfile, context = dirname(dockerfile), args } = config.build;
  return {
    build: { context, dockerfile: relative(context, dockerfile), ...(args && { args }) },
    image: `${containerName}:local`,
  };
}

export function buildCompose(config, ports, identity) {
  const { containerName, hermesWorkspace, launchOnBoot, env, mounts, ssh } = config;
  const { uid, gid } = identity;
  const restart = launchOnBoot ? 'unless-stopped' : 'no';

  const volumes = [
    `${hermesWorkspace}/hermes:/opt/data`,
    `${hermesWorkspace}/claude-code:/opt/data/.claude`,
    ...mounts.map((m) => (m.mode === 'ro'
      ? `${m.host}:${m.containerPath}:ro`
      : `${m.host}:${m.containerPath}`)),
  ];

  const environment = {
    HERMES_UID: String(uid),
    HERMES_GID: String(gid),
    // Run the dashboard as an s6 service, bound non-loopback (insecure — the
    // host publish is loopback-only). Mirrors hermes' old `--insecure`.
    HERMES_DASHBOARD: 'true',
    HERMES_DASHBOARD_INSECURE: 'true',
    ...env,
  };
  const portList = [
    `127.0.0.1:${ports.gateway}:8642`,
    `127.0.0.1:${ports.dashboard}:9119`,
  ];

  // SSH wiring: sshd is started by the image's cont-init hook, gated on
  // SSH_ENABLED; password/key + the published port come from here.
  if (ssh.enabled) {
    environment.SSH_ENABLED = 'true';
    if (ssh.password) environment.SSH_PASSWORD = ssh.password;
    portList.push(`${ports.ssh}:22`);
    if (ssh.authorizedKey) volumes.push(`${ssh.authorizedKey}:/etc/ssh/keys/hermes:ro`);
  } else {
    environment.SSH_ENABLED = 'false';
  }

  const service = {
    ...imageOrBuild(config, containerName),
    container_name: containerName,
    command: ['gateway', 'run'],
    restart,
    // compose loads env_file first, then `environment:` (which wins) — secrets in
    // the .env, overrides inline.
    ...(config.envFile && { env_file: [config.envFile] }),
    ports: portList,
    environment,
    volumes,
  };

  return { name: containerName, services: { hermes: service } };
}
