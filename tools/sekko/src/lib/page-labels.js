// Map a page URL to a short label that goes in screenshot filenames
// and the actions.md "Page" column. Returns null for regular http/https
// pages (no suffix; today's behavior preserved).

const KNOWN_LABELS = {
  'popup.html': 'popup',
  // index.html is the conventional MV3 popup filename for extensions
  // bundled with Vite/webpack/etc. Treating it as popup covers the
  // common case (e.g., JD's extension). False positive: extensions
  // where index.html is actually the options page would be mislabeled.
  'index.html': 'popup',
  'sidepanel.html': 'sidepanel',
  'options.html': 'options',
  'options_page.html': 'options',
};

export function isExtensionUrl(url) {
  if (typeof url !== 'string') return false;
  return url.startsWith('chrome-extension://');
}

export function derivePageLabel(url) {
  if (!isExtensionUrl(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'ext';
  }
  const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
  if (KNOWN_LABELS[last]) return KNOWN_LABELS[last];
  // Unknown chrome-extension page — generic label
  return 'ext';
}
