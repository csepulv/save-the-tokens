export function formatTerminalSummary({ commandCount, narrationWordCount }) {
  const lines = [
    '# Terminal Session Extraction Summary',
    '',
    'Artifacts extracted from a terminal recording for agent consumption.',
    '',
    '## Artifacts',
    '',
    '| Artifact | Contents | Count |',
    '|----------|----------|-------|',
    `| [terminal-session.md](./terminal-session.md) | Chronological log of commands with output, exit codes, and timestamps | ${commandCount} commands |`,
    `| [terminal-session.json](./terminal-session.json) | Structured command data for programmatic access | ${commandCount} commands |`,
    ...(narrationWordCount ? [`| [narration.md](./narration.md) | Timestamped voice-over transcript | ${narrationWordCount} words |`] : []),
    '',
    '## How to Use These Artifacts',
    '',
    '1. **Start here** — read this file to understand what was captured',
    '2. **Terminal session** — `terminal-session.md` shows every command run, in order, with its output and exit code.',
    '3. **Structured data** — `terminal-session.json` has the same data in JSON for programmatic use.',
    ...(narrationWordCount ? [
      '4. **Narration** — `narration.md` is a timestamped voice-over transcript. The user narrated what they were doing and why. Cross-reference timestamps with commands to understand intent.',
    ] : []),
    '',
    '## Quick Reference',
    '',
    `- **Total commands:** ${commandCount}`,
    ...(narrationWordCount ? [`- **Narration words:** ${narrationWordCount}`] : []),
  ];

  return lines.join('\n');
}
