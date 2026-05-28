/**
 * Assign stable IDs to network entries and produce the JSON detail array.
 *
 * The `origin` field tags where each entry came from:
 *   - 'page'           — Playwright trace.zip (page-driven traffic)
 *   - 'service-worker' — extension SW network (--trace-extensions)
 *   - 'popup' / 'sidepanel' / 'options' / 'extension' — extension page targets
 * Older recordings (or extracts without --trace-extensions) tag every
 * entry as 'page'.
 */
export function buildNetworkDetail(entries) {
  return entries.map((entry, i) => {
    const id = i + 1;
    return {
      id,
      origin: entry.origin || 'page',
      method: entry.method,
      url: entry.url,
      status: entry.status,
      statusText: entry.statusText || null,
      mimeType: entry.mimeType || null,
      startedDateTime: entry.startedDateTime,
      durationMs: entry.durationMs || null,
      requestBody: entry.requestBody || null,
      responseBody: entry.responseBody || null,
      actionIndex: entry.actionIndex || null,
    };
  });
}
