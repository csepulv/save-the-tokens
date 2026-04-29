import { Command } from 'commander';
import { trace } from './commands/trace.js';
import { extract } from './commands/extract.js';
import { transcribeCommand } from './commands/transcribe.js';
import { setupCommand } from './commands/setup.js';
import { recordTerminal } from './commands/record-terminal.js';
import { profileList, profileRm } from './commands/profile.js';

export function run(argv) {
  const program = new Command();

  program
    .name('sekko')
    .description('Capture Playwright traces and produce agent-consumable artifacts')
    .version('1.0.0');

  const recordWebOptions = (cmd) => cmd
    .argument('<url>', 'URL to open in the browser')
    .option('-o, --output <dir>', 'output directory', './sekko-output')
    .option('--auth <path>', 'load browser storage state from a JSON file')
    .option('--save-auth <path>', 'save browser storage state to a JSON file on close')
    .option('--profile <name>', 'use a persistent profile at ~/.sekko/profiles/<name>')
    .option('--user-data-dir <path>', 'use a persistent profile at an arbitrary path')
    .option('--load-extension <paths>', 'comma-separated unpacked extension dirs (requires --profile or --user-data-dir)')
    .option('--connect [url]', 'attach to a running Chrome via CDP instead of launching one (default: http://127.0.0.1:9222)')
    .option('--viewport <wxh>', 'fixed viewport size (e.g., 1920x1080); default tracks the window')
    .option('--system-screenshots', 'use full-window screencaptures (1Hz) instead of Playwright page-area screenshots; needed to capture extension popups and browser chrome')
    .option('--no-sanitize', 'skip HAR sanitization (default: redact cookies, auth headers, query/body tokens, and known credential patterns)')
    .option('--narrate', 'record voice-over audio during the session (requires SoX)')
    .option('--keyterm <terms>', 'domain-specific terms to improve transcription accuracy (comma-separated)')
    .action(trace);

  recordWebOptions(
    program.command('record-web').description('Record a Playwright trace of a browser session')
  );

  recordWebOptions(
    program.command('trace', { hidden: true }).description('Alias for record-web')
  );

  program
    .command('record-terminal')
    .description('Record a terminal session')
    .option('-o, --output <dir>', 'output directory', './sekko-output')
    .option('--shell <shell>', 'shell to use (zsh or bash)')
    .option('--narrate', 'record voice-over audio during the session (requires SoX)')
    .option('--keyterm <terms>', 'domain-specific terms to improve transcription accuracy (comma-separated)')
    .action(recordTerminal);

  program
    .command('extract')
    .description('Extract agent-consumable artifacts from a Playwright trace')
    .argument('<trace>', 'path to trace.zip file')
    .option('-o, --output <dir>', 'output directory', './sekko-extract')
    .option('--include-hosts <hosts>', 'only include network requests to these hosts (comma-separated)')
    .option('--exclude-hosts <hosts>', 'exclude network requests to these hosts (comma-separated)')
    .action(extract);

  program
    .command('transcribe')
    .description('Transcribe a voice-over recording to narration.json')
    .argument('<audio-file>', 'path to voice-over WAV file')
    .option('-o, --output <dir>', 'output directory (defaults to audio file directory)')
    .option('--keyterm <terms>', 'domain-specific terms to improve transcription accuracy (comma-separated)')
    .action(transcribeCommand);

  program
    .command('setup')
    .description('Check and install dependencies for narration (SoX, whisper-cpp, model)')
    .action(setupCommand);

  const profile = program
    .command('profile')
    .description('Manage persistent browser profiles for record-web');

  profile
    .command('list')
    .description('List profiles in ~/.sekko/profiles/')
    .action(() => profileList());

  profile
    .command('rm')
    .description('Remove a profile')
    .argument('<name>', 'profile name')
    .action((name) => profileRm(name));

  program.parse(argv);
}
