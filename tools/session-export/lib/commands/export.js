import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findJsonl, extractEncodedProjectDir } from '../discover.js';
import { parseConversation } from '../parse.js';
import { filterTurns } from '../filter-turns.js';
import { formatMarkdown } from '../format-markdown.js';
import { formatText } from '../format-text.js';
import { resolveProjectName } from '../project-name.js';
import { loadConfig, resolveSource, resolveOutputPath, makeSlug } from '../config.js';

/**
 * Export one or more conversations.
 *
 * args: { id, all, include-tools, include-system, include-all,
 *         include-timestamps, include-skill-text, format, source }
 * outputFlag: undefined (no --output) | true (bare --output) | string (--output <path>)
 *
 * When the id matches multiple sessions:
 *   - without --all: lists matches, exits non-zero, writes nothing
 *   - with --all: emits every match (stdout: concat; --output <dir>/: one file
 *     per session with id-suffix on title collision; --output <file>: refused)
 */
export async function run(args, { outputFlag } = {}) {
  const config = await loadConfig();
  const sourceDir = resolveSource(args.source, config);
  const format = args.format ?? 'md';
  const source = args.id;
  const all = !!args.all;

  let jsonlPaths;
  if (existsSync(source)) {
    jsonlPaths = [source];
  } else {
    jsonlPaths = await findJsonl(source, sourceDir);
  }

  if (jsonlPaths.length === 0) {
    console.error(`Error: Could not find conversation JSONL for '${source}'`);
    console.error(`Searched: ${sourceDir}/projects/**/${source}*.jsonl`);
    process.exit(1);
  }

  if (jsonlPaths.length > 1 && !all) {
    console.error(`Error: '${source}' matches ${jsonlPaths.length} sessions. Re-run with --all to emit every match, or pick a more specific id/title.\n`);
    for (const p of jsonlPaths) {
      const name = p.split('/').pop().replace('.jsonl', '');
      const encoded = extractEncodedProjectDir(p);
      const project = encoded ? await resolveProjectName(encoded) : '';
      console.error(`${name}\t${project}\t${p}`);
    }
    process.exit(1);
  }

  if (jsonlPaths.length > 1 && all && isLiteralFileOutput(outputFlag)) {
    console.error(`Error: --all with --output <file> is ambiguous (multiple sessions, one file). Use --output <dir>/ or omit --output.`);
    process.exit(1);
  }

  for (const jsonlPath of jsonlPaths) {
    if (!existsSync(jsonlPath)) {
      console.error(`Error: ${jsonlPath} does not exist`);
      process.exit(1);
    }

    console.error(`Reading: ${jsonlPath}`);

    const conversation = await parseConversation(jsonlPath);

    let filtered;
    try {
      filtered = filterTurns(conversation, {
        userOnly: args['user-only'],
        skipTurns: args['skip-turns'] ?? 0,
        limitTurns: args['limit-turns'],
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }

    const formatOptions = {
      includeTools: args['include-tools'],
      includeSystem: args['include-system'],
      includeAll: args['include-all'],
      includeTimestamps: args['include-timestamps'],
      includeSkillText: args['include-skill-text'],
    };

    const formatter = format === 'text' ? formatText : formatMarkdown;
    const result = formatter(filtered, formatOptions);

    const outputPath = resolveOutputForBatch(outputFlag, conversation, config, jsonlPaths.length > 1);

    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result);
      const lineCount = result.split('\n').length;
      console.error(`Wrote ${lineCount} lines to ${outputPath}`);
    } else {
      process.stdout.write(result);
    }
  }
}

function isLiteralFileOutput(outputFlag) {
  if (outputFlag === undefined) return false;
  if (outputFlag === true || outputFlag === '') return false;
  const v = String(outputFlag);
  return !v.endsWith('/');
}

// For --all into a directory, suffix the filename with sessionId if the
// title-derived slug would collide. Single-session calls fall through to
// the existing resolveOutputPath behavior.
function resolveOutputForBatch(outputFlag, conversation, config, isBatch) {
  if (!isBatch) return resolveOutputPath(outputFlag, conversation, config);

  const slug = makeSlug(conversation);
  const sessionId = conversation.metadata?.sessionId ?? 'export';
  const suffixedSlug = slug === sessionId ? slug : `${slug}-${sessionId.slice(0, 8)}`;

  if (outputFlag === undefined) return null;

  if (outputFlag === '' || outputFlag === true) {
    if (!config.outputDir) {
      throw new Error('--output requires a path argument, or set outputDir in ~/.session-export.yaml');
    }
    return join(config.outputDir, `${suffixedSlug}.md`);
  }

  const value = String(outputFlag);
  if (value.endsWith('/')) {
    return join(value, `${suffixedSlug}.md`);
  }

  // Literal file path with --all already rejected above; defensive fallback.
  return value;
}
