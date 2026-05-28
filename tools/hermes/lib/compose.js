// Build the docker-compose.yml object for one hermes container — two services
// (gateway + dashboard) sharing the image and the workspace mounts.

const IMAGE = 'hermes-claude';

// Mutates the two service objects to add SSH wiring. sshd runs only on the
// gateway; the dashboard is always told SSH_ENABLED=false.
function applySshWiring(services, ssh, ports) {
  const { gateway, dashboard } = services;
  dashboard.environment.SSH_ENABLED = 'false';

  if (!ssh.enabled) {
    gateway.environment.SSH_ENABLED = 'false';
    return;
  }

  gateway.environment.SSH_ENABLED = 'true';
  if (ssh.password) gateway.environment.SSH_PASSWORD = ssh.password;
  // SSH port is bound to all interfaces — LAN access is the point.
  gateway.ports.push(`${ports.ssh}:22`);
  if (ssh.authorizedKey) {
    gateway.volumes.push(`${ssh.authorizedKey}:/etc/ssh/keys/hermes:ro`);
  }
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
  const baseEnv = { HERMES_UID: String(uid), HERMES_GID: String(gid) };

  const gateway = {
    image: IMAGE,
    container_name: containerName,
    command: ['gateway', 'run'],
    restart,
    ports: [`127.0.0.1:${ports.gateway}:8642`],
    environment: { ...baseEnv, ...env },
    volumes: [...volumes],
  };
  const dashboard = {
    image: IMAGE,
    container_name: `${containerName}-dashboard`,
    command: ['dashboard', '--host', '0.0.0.0', '--no-open', '--insecure'],
    restart,
    depends_on: ['gateway'],
    ports: [`127.0.0.1:${ports.dashboard}:9119`],
    environment: { ...baseEnv },
    volumes: [...volumes],
  };

  applySshWiring({ gateway, dashboard }, ssh, ports);

  return { name: containerName, services: { gateway, dashboard } };
}
