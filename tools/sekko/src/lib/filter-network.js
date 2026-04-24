/**
 * Filter network entries by host include/exclude lists.
 * If no filters are configured, returns all entries.
 */
export function filterNetwork(entries, config = {}) {
  const { includeHosts, excludeHosts } = config;

  if (!includeHosts && !excludeHosts) return entries;

  return entries.filter((entry) => {
    const host = extractHost(entry.url);
    if (!host) return !includeHosts;

    if (includeHosts && includeHosts.length > 0) {
      return includeHosts.some((h) => host === h);
    }

    if (excludeHosts && excludeHosts.length > 0) {
      return !excludeHosts.some((h) => host === h);
    }

    return true;
  });
}

function extractHost(url) {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return null;
  }
}
