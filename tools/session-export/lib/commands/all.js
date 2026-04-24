import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConversation } from '../parse.js';
import { formatMarkdown } from '../format-markdown.js';
import { loadConfig, expandTilde, makeSlug, resolveSource } from '../config.js';
import { listConversations } from '../discover.js';
import { collectAllEntries } from '../source-entries.js';
import {
  groupByProject,
  filterProjects,
  filterByDate,
  buildFlatNames,
  uniqueSlug,
} from '../export-all.js';
import { parseDateArg } from '../date.js';

/**
 * Bulk export all matching conversations into per-project folders.
 *
 * args: { outputDir, source?, filter?, after?, before?, config?,
 *         exclude-timestamps, include-skill-text }
 *
 *   - source absent → walk all configured sources
 *   - source given  → only that source, tagged with its name
 *
 * Each session produces <slug>.md (default export) and <slug>.full.md
 * (include-all export). Project folders use the project path's leaf name;
 * collisions are disambiguated by slugifying the full path.
 */
export async function run(args) {
  let afterDate = null;
  let beforeDate = null;
  try {
    if (args.after) afterDate = parseDateArg(args.after, { endOfDay: false });
    if (args.before) beforeDate = parseDateArg(args.before, { endOfDay: true });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const configDeps = args.config
    ? { configPath: expandTilde(args.config) }
    : {};
  const config = await loadConfig(configDeps);
  const outputDir = expandTilde(args['output-dir']);

  const entries = args.source
    ? await collectFromSource(args.source, config)
    : await collectAllEntries(config);

  const dated = filterByDate(entries, afterDate, beforeDate);
  const byProject = groupByProject(dated);
  const filtered = filterProjects(byProject, args.filter);

  if (filtered.size === 0) {
    console.error('No conversations found.');
    return;
  }

  const flatNames = buildFlatNames(filtered);

  let sessionCount = 0;
  let fileCount = 0;

  for (const [projectPath, projectEntries] of filtered) {
    const folderName = flatNames.get(projectPath);
    const projectDir = join(outputDir, folderName);
    await mkdir(projectDir, { recursive: true });

    const usedSlugs = new Set();

    for (const entry of projectEntries) {
      const conversation = await parseConversation(entry.path);
      const slug = uniqueSlug(makeSlug(conversation), entry.sessionId, usedSlugs);
      usedSlugs.add(slug);

      const includeTimestamps = !args['exclude-timestamps'];
      const includeSkillText = args['include-skill-text'];
      const defaultOutput = formatMarkdown(conversation, { includeTimestamps, includeSkillText });
      const fullOutput = formatMarkdown(conversation, { includeAll: true, includeSkillText });

      await writeFile(join(projectDir, `${slug}.md`), defaultOutput);
      await writeFile(join(projectDir, `${slug}.full.md`), fullOutput);

      console.error(`  [${folderName}] ${slug}.md + .full.md`);
      sessionCount++;
      fileCount += 2;
    }
  }

  console.error(`\nDone. ${filtered.size} projects, ${sessionCount} sessions, ${fileCount} files written.`);
}

async function collectFromSource(sourceName, config) {
  const sourceDir = resolveSource(sourceName, config);
  const entries = await listConversations(sourceDir);
  for (const entry of entries) entry.sourceName = sourceName;
  return entries;
}
