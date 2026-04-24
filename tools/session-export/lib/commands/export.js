import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { findJsonl } from '../discover.js';
import { parseConversation } from '../parse.js';
import { formatMarkdown } from '../format-markdown.js';
import { formatText } from '../format-text.js';
import { loadConfig, resolveSource, resolveOutputPath } from '../config.js';

/**
 * Export one conversation.
 *
 * args: { id, include-tools, include-system, include-all, include-timestamps,
 *         include-skill-text, format, source }
 * outputFlag: undefined (no --output) | true (bare --output) | string (--output <path>)
 */
export async function run(args, { outputFlag } = {}) {
  const config = await loadConfig();
  const sourceDir = resolveSource(args.source, config);
  const format = args.format ?? 'md';
  const source = args.id;

  let jsonlPath = null;
  if (existsSync(source)) {
    jsonlPath = source;
  } else {
    jsonlPath = await findJsonl(source, sourceDir);
  }

  if (!jsonlPath || !existsSync(jsonlPath)) {
    console.error(`Error: Could not find conversation JSONL for '${source}'`);
    console.error(`Searched: ${sourceDir}/projects/**/${source}*.jsonl`);
    process.exit(1);
  }

  console.error(`Reading: ${jsonlPath}`);

  const conversation = await parseConversation(jsonlPath);

  const formatOptions = {
    includeTools: args['include-tools'],
    includeSystem: args['include-system'],
    includeAll: args['include-all'],
    includeTimestamps: args['include-timestamps'],
    includeSkillText: args['include-skill-text'],
  };

  const formatter = format === 'text' ? formatText : formatMarkdown;
  const result = formatter(conversation, formatOptions);

  const outputPath = resolveOutputPath(outputFlag, conversation, config);

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result);
    const lineCount = result.split('\n').length;
    console.error(`Wrote ${lineCount} lines to ${outputPath}`);
  } else {
    process.stdout.write(result);
  }
}
