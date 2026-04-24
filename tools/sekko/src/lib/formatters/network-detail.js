/**
 * Assign stable IDs to network entries and produce the JSON detail array.
 */
export function buildNetworkDetail(entries) {
  return entries.map((entry, i) => {
    const id = i + 1;
    return {
      id,
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
