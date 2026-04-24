#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { extractOptionalFlag } from '../lib/argv.js';
import * as exportCmd from '../lib/commands/export.js';
import * as listCmd from '../lib/commands/list.js';
import * as allCmd from '../lib/commands/all.js';
import * as statsCmd from '../lib/commands/stats.js';

// `--output` accepts an optional value (bare, path, or dir/). yargs doesn't
// model this natively, so extract it before yargs parses the rest.
const rawArgv = hideBin(process.argv);
const { value: outputFlag, remaining: afterOutput } = extractOptionalFlag(rawArgv, '--output');

await yargs(afterOutput)
  .scriptName('session-export')
  .usage('$0 <command> [options]')
  .command(
    '$0 [id]',
    'Export a conversation by ID or custom title (default when <id> given)',
    (y) => y
      .positional('id', {
        type: 'string',
        describe: 'Conversation ID (partial match) or custom title',
      })
      .option('include-tools', { type: 'boolean', default: false, describe: 'Include assistant tool calls' })
      .option('include-system', { type: 'boolean', default: false, describe: 'Include system messages' })
      .option('include-timestamps', { type: 'boolean', default: false, describe: 'Include per-message timestamps' })
      .option('include-skill-text', { type: 'boolean', default: false, describe: 'Keep full skill bodies (default: first 2 lines)' })
      .option('include-all', { type: 'boolean', default: false, describe: 'Include everything: tools, results, thinking, subagents, system, timestamps' })
      .option('format', { type: 'string', default: 'md', choices: ['md', 'text'], describe: 'Output format' })
      .option('source', { type: 'string', default: 'default', describe: 'Source alias or path (default: "default")' }),
    async (args) => {
      if (!args.id) {
        console.error('Error: conversation ID or title required.\n');
        console.error('Run `session-export --help` or `session-export <command> --help`.');
        process.exit(1);
      }
      await exportCmd.run(args, { outputFlag });
    }
  )
  .command(
    ['list', 'ls'],
    'List conversations',
    (y) => y
      .option('source', { type: 'string', describe: 'Restrict to one source (default: walk all)' })
      .option('filter', { type: 'string', describe: 'Filter by project path substring' }),
    (args) => listCmd.run(args)
  )
  .command(
    'all <output-dir>',
    'Bulk-export every conversation into per-project folders',
    (y) => y
      .positional('output-dir', { type: 'string', describe: 'Destination directory' })
      .option('source', { type: 'string', describe: 'Restrict to one source (default: walk all)' })
      .option('filter', { type: 'string', describe: 'Filter by project path substring' })
      .option('after', { type: 'string', describe: 'Include sessions on/after (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('before', { type: 'string', describe: 'Include sessions on/before (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('config', { type: 'string', describe: 'Path to config file (default: ~/.session-export.yaml)' })
      .option('exclude-timestamps', { type: 'boolean', default: false, describe: 'Omit per-message timestamps' })
      .option('include-skill-text', { type: 'boolean', default: false, describe: 'Keep full skill bodies' }),
    (args) => allCmd.run(args)
  )
  .command(
    'stats',
    'Aggregate per-session stats as JSON',
    (y) => y
      .option('after', { type: 'string', demandOption: true, describe: 'Window start (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('before', { type: 'string', demandOption: true, describe: 'Window end (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('source', { type: 'string', describe: 'Restrict to one source (default: walk all)' })
      .option('format', { type: 'string', default: 'json', choices: ['json'], describe: 'Output format' })
      .option('config', { type: 'string', describe: 'Path to config file (default: ~/.session-export.yaml)' }),
    (args) => statsCmd.run(args)
  )
  .demandCommand(0)
  .help()
  .strict()
  .parseAsync();
