/**
 * Generate a summary manifest describing all produced artifacts.
 */
export function formatSummary({ actionCount, selectorCount, networkCount, networkOriginCounts, screenshotCount, screenshotSource, narrationWordCount, outputDir }) {
  const isSystemSource = screenshotSource === 'system';
  const screenshotsDescription = isSystemSource
    ? 'Full-window screenshots (browser chrome + page; includes extension popups), one per action'
    : 'Page-area screenshots, one per action';
  const screenshotsHowto = isSystemSource
    ? '6. **Screenshots** — `screenshots/action-NN.jpeg` shows the full browser window (including chrome and any extension popups visible) at the moment of each action. Source: system-level screencapture (1Hz during recording).'
    : '6. **Screenshots** — `screenshots/action-NN.jpeg` shows the page-area visual state at the moment of each action. Source: Playwright trace.';

  const networkLine = formatNetworkLine(networkCount, networkOriginCounts);

  const lines = [
    '# Trace Extraction Summary',
    '',
    'Artifacts extracted from a Playwright trace for agent consumption.',
    '',
    '## Artifacts',
    '',
    `| Artifact | Contents | Count |`,
    `|----------|----------|-------|`,
    `| [actions.md](./actions.md) | Chronological log of user actions with selectors and correlated network request IDs | ${actionCount} actions |`,
    `| [network.md](./network.md) | HTTP request summary table with IDs, correlated to actions | ${networkLine} |`,
    `| [network-detail.json](./network-detail.json) | Full request/response bodies for each network entry (by ID) | ${networkCount} entries |`,
    `| [selectors.md](./selectors.md) | Unique selectors for interactive elements | ${selectorCount} selectors |`,
    `| [screenshots/](./screenshots/) | ${screenshotsDescription} | ${screenshotCount} images |`,
    ...(narrationWordCount ? [`| [narration.md](./narration.md) | Timestamped voice-over transcript | ${narrationWordCount} words |`] : []),
    '',
    '## How to Use These Artifacts',
    '',
    '1. **Start here** — read this file to understand what was captured',
    '2. **Actions** — `actions.md` shows what the user did, in order. Each action includes the selector used and IDs of network requests it triggered.',
    '3. **Network overview** — `network.md` is a summary table. Scan it to see endpoints, status codes, and which action triggered each request.',
    '4. **Network detail** — `network-detail.json` has full request/response bodies. Read specific entries by ID when you need request shapes or response data.',
    '5. **Selectors** — `selectors.md` lists every unique selector. Use these to interact with the app.',
    screenshotsHowto,
    ...(narrationWordCount ? [
      '7. **Narration** — `narration.md` is a timestamped voice-over transcript. The user narrated what they were doing and why. Cross-reference timestamps with actions to understand intent behind each step.',
    ] : []),
    '',
    '## Quick Reference',
    '',
    `- **Total actions:** ${actionCount}`,
    `- **Total network requests:** ${networkLine}`,
    `- **Unique selectors:** ${selectorCount}`,
    `- **Screenshots:** ${screenshotCount} (source: ${isSystemSource ? 'system' : 'playwright'})`,
    ...(narrationWordCount ? [`- **Narration words:** ${narrationWordCount}`] : []),
  ];

  return lines.join('\n');
}

// Render the network count as either "N requests" or, when there's
// extension capture, "N requests (M page, X service-worker, Y popup, …)"
// so the consuming agent immediately sees how the requests break down
// by source.
function formatNetworkLine(total, originCounts) {
  if (!originCounts) return `${total} requests`;
  const nonPage = Object.entries(originCounts).filter(([k]) => k !== 'page');
  if (nonPage.length === 0) return `${total} requests`;
  const parts = Object.entries(originCounts)
    .filter(([_, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  return `${total} requests (${parts.join(', ')})`;
}
