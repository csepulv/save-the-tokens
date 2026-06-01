// cli.js — Command dispatch (commander). Handlers are injectable so the
// argument wiring can be tested without touching docker or the filesystem.

import { Command } from 'commander';
import { launch as realLaunch } from './commands/launch.js';
import { syncConfig as realSync } from './commands/sync.js';
import { buildImage as realBuild, buildDaemonImage as realBuildDaemon } from './commands/build.js';

export function run(argv, handlers = {}) {
  const { launch = realLaunch, sync = realSync, build = realBuild, buildDaemon = realBuildDaemon } = handlers;
  const program = new Command();

  program
    .name('agent-isolation')
    .description('Run isolated Claude Code containers from a YAML config.');

  program
    .command('launch')
    .description('Run, resume, or attach to an agent container')
    .option('--config <file>', 'agent config file (auto-detects a single *.agent.yml)')
    .option('--name <name>', 'override the container name')
    .option('--autonomous <prompt>', 'headless: run claude with a prompt')
    .option('--resume', 'resume the last conversation')
    .option('--build', 'rebuild the image before launch')
    .option('--dry-run', 'print the docker command without executing')
    .action((opts) => {
      const result = launch({
        configArg: opts.config || '',
        name: opts.name || '',
        autonomous: opts.autonomous || '',
        resume: Boolean(opts.resume),
        build: Boolean(opts.build),
        dryRun: Boolean(opts.dryRun),
      });
      // Propagate the container's exit code (mirrors bash `exit "$RUN_EXIT"`).
      if (result && result.exitCode) process.exitCode = result.exitCode;
    });

  program
    .command('sync')
    .description('Sync ~/.claude into the agent-claude config dir')
    .option('--config <file>', 'agent config file (auto-detects a single *.agent.yml)')
    .option('--source <dir>', 'alternate host claude dir (default: ~/.claude)')
    .option('--force', 'wipe target and sync fresh')
    .option('--headless', 'strip statusLine (for autonomous runs)')
    .option('--include-all', 'copy projects/sessions/cache too')
    .action((opts) => {
      sync({
        configArg: opts.config || '',
        sourceDir: opts.source || '',
        force: Boolean(opts.force),
        headless: Boolean(opts.headless),
        includeAll: Boolean(opts.includeAll),
      });
    });

  program
    .command('build [target]')
    .description('Build a Docker image — default: interactive (claude-agent); `daemon`: hermes-claude')
    .option('--no-cache', 'skip the Docker build cache')
    .action((target, opts) => {
      const noCache = opts.cache === false;
      if (target === 'daemon') {
        buildDaemon({ noCache });
      } else if (!target || target === 'interactive') {
        build({ noCache });
      } else {
        console.error(`Unknown build target '${target}' — use 'daemon' or omit for interactive.`);
        process.exitCode = 1;
      }
    });

  program.parse(argv);
}
