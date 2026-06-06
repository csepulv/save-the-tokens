#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { extractOptionalFlag } from '../lib/argv.js';
import * as exportCmd from '../lib/commands/export.js';
import * as listCmd from '../lib/commands/list.js';
import * as allCmd from '../lib/commands/all.js';
import * as statsCmd from '../lib/commands/stats.js';
import * as getIdCmd from '../lib/commands/get-id.js';
import * as mergeCmd from '../lib/commands/merge.js';
import * as copyCmd from '../lib/commands/copy.js';
import * as moveCmd from '../lib/commands/move.js';
import * as removeCmd from '../lib/commands/remove.js';

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
      .option('user-only', { type: 'boolean', default: false, describe: 'Emit only human-typed user prose (drops assistant, system, subagents)' })
      .option('skip-turns', { type: 'number', describe: 'Skip the first N user/assistant turns' })
      .option('limit-turns', { type: 'number', describe: 'Emit at most N user/assistant turns' })
      .option('format', { type: 'string', default: 'md', choices: ['md', 'text'], describe: 'Output format' })
      .option('source', { type: 'string', default: 'default', describe: 'Source alias or path (default: "default")' })
      .option('all', { type: 'boolean', default: false, describe: 'Emit every matching session (default: halt on ambiguity)' }),
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
      .option('filter', { type: 'string', describe: 'Filter by project path substring' })
      .option('after', { type: 'string', describe: 'Include sessions on/after (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('before', { type: 'string', describe: 'Include sessions on/before (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' })
      .option('format', { type: 'string', default: 'table', choices: ['table', 'json'], describe: 'Output format (json: machine-readable, full ISO timestamps)' }),
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
      .option('include-skill-text', { type: 'boolean', default: false, describe: 'Keep full skill bodies' })
      .option('user-only', { type: 'boolean', default: false, describe: 'Emit only human-typed user prose; skips .full.md (redundant)' })
      .option('skip-turns', { type: 'number', describe: 'Skip the first N user/assistant turns' })
      .option('limit-turns', { type: 'number', describe: 'Emit at most N user/assistant turns' }),
    (args) => allCmd.run(args)
  )
  .command(
    'get-id <slug>',
    'Resolve a custom-title slug to its session UUID(s)',
    (y) => y
      .positional('slug', { type: 'string', describe: 'Exact custom title (set via Claude Code /rename)' })
      .option('source', { type: 'string', describe: 'Restrict to one source (default: walk all)' }),
    (args) => getIdCmd.run(args),
  )
  .command(
    'merge [id]',
    'One-way file-level sync of session JSONL files between Claude folders',
    (y) => y
      .positional('id', { type: 'string', describe: 'Session slug or full UUID — limits the merge to that one session' })
      .option('source', { type: 'string', demandOption: true, describe: 'Source alias or path (where sessions come from)' })
      .option('dest', { type: 'string', default: 'default', describe: 'Dest alias or path (default: "default")' })
      .option('project', { type: 'string', describe: 'Limit to one project (display name, exact)' })
      .option('all', { type: 'boolean', default: false, describe: 'Merge every session' })
      .option('force', { type: 'boolean', default: false, describe: 'Overwrite even when dest mtime is newer' })
      .option('skip-newer', { type: 'boolean', default: false, describe: 'Skip files where dest mtime is newer; copy the rest' }),
    (args) => mergeCmd.run(args),
  )
  .command(
    'copy [id]',
    'Copy session JSONL files between Claude folders (overwrites dest unconditionally)',
    (y) => y
      .positional('id', { type: 'string', describe: 'Exact session UUID or exact custom-title slug (no substring match)' })
      .option('source', { type: 'string', demandOption: true, describe: 'Source alias or path (where sessions come from)' })
      .option('dest', { type: 'string', default: 'default', describe: 'Dest alias or path (default: "default")' })
      .option('project', { type: 'string', describe: 'Exact project display name, or pattern with `*`' }),
    (args) => copyCmd.run(args),
  )
  .command(
    'move [id]',
    'Move session JSONL files between Claude folders (dry-run by default — pass --yes to execute)',
    (y) => y
      .positional('id', { type: 'string', describe: 'Exact session UUID or exact custom-title slug (no substring match)' })
      .option('source', { type: 'string', demandOption: true, describe: 'Source alias or path (where sessions come from)' })
      .option('dest', { type: 'string', default: 'default', describe: 'Dest alias or path (default: "default")' })
      .option('project', { type: 'string', describe: 'Exact project display name, or pattern with `*`' })
      .option('yes', { type: 'boolean', default: false, describe: 'Execute the move (default: dry-run / list only)' }),
    (args) => moveCmd.run(args),
  )
  .command(
    'remove [id]',
    'Delete session JSONL files; cleans up empty project dirs (dry-run by default — pass --yes to execute)',
    (y) => y
      .positional('id', { type: 'string', describe: 'Exact session UUID or exact custom-title slug (no substring match)' })
      .option('project', { type: 'string', describe: 'Exact project display name, or pattern with `*` (e.g., `claude-monitor-*`)' })
      .option('source', { type: 'string', describe: 'Restrict to one source (default: walk all)' })
      .option('yes', { type: 'boolean', default: false, describe: 'Execute the deletion (default: dry-run / list only)' }),
    (args) => removeCmd.run(args),
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
