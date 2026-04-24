/**
 * Format network entries into a markdown summary table.
 * Bodies are in network-detail.json — this file references entries by ID.
 */
export function formatNetwork(detailEntries) {
  const lines = [
    '# Network',
    '',
    'HTTP requests and responses captured during the session.',
    'Full request/response bodies are in `network-detail.json` (referenced by ID).',
    '',
  ];

  if (detailEntries.length === 0) {
    lines.push('_No network requests captured._');
    return lines.join('\n');
  }

  lines.push('| ID | Method | URL | Status | Duration | Type | Action |');
  lines.push('|----|--------|-----|--------|----------|------|--------|');

  for (const e of detailEntries) {
    const url = truncateUrl(e.url, 80);
    const duration = e.durationMs ? `${Math.round(e.durationMs)}ms` : '—';
    const mimeType = e.mimeType ? simplifyMime(e.mimeType) : '—';
    const action = e.actionIndex ? `#${e.actionIndex}` : '—';
    lines.push(`| ${e.id} | ${e.method} | ${url} | ${e.status} | ${duration} | ${mimeType} | ${action} |`);
  }

  return lines.join('\n');
}

function simplifyMime(mime) {
  if (mime.includes('json')) return 'json';
  if (mime.includes('html')) return 'html';
  if (mime.includes('javascript')) return 'js';
  if (mime.includes('css')) return 'css';
  if (mime.includes('image')) return 'image';
  if (mime.includes('font')) return 'font';
  return mime.split('/').pop() || mime;
}

function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + '...';
}
