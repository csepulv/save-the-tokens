import { findJsonlByExactTitle, extractEncodedProjectDir } from '../discover.js';
import { resolveProjectName } from '../project-name.js';
import { loadConfig, resolveSource } from '../config.js';

/**
 * Resolve a custom-title slug to its session UUID(s).
 *
 * args: { slug, source? }
 *   - source absent → search every configured source
 *   - source given  → search just that one (alias or path)
 *
 * Output: one tab-separated line per match — `<sessionId>\t<source>\t<project>`.
 * Exits non-zero if no matches; exits zero (and lists every match) when
 * one or more match. The caller / pipeline disambiguates.
 */
export async function run(args) {
  const config = await loadConfig();

  const sourcesToSearch = args.source
    ? [{ name: args.source, dir: resolveSource(args.source, config) }]
    : Object.entries(config.sources).map(([name, dir]) => ({ name, dir }));

  const matches = [];
  for (const { name, dir } of sourcesToSearch) {
    const paths = await findJsonlByExactTitle(args.slug, dir);
    for (const p of paths) {
      const sessionId = p.split('/').pop().replace('.jsonl', '');
      const encoded = extractEncodedProjectDir(p);
      const project = encoded ? await resolveProjectName(encoded) : '';
      matches.push({ sessionId, source: name, project });
    }
  }

  if (matches.length === 0) {
    console.error(`No matches for slug '${args.slug}'`);
    process.exit(1);
  }

  for (const m of matches) {
    console.log(`${m.sessionId}\t${m.source}\t${m.project}`);
  }
}
