import { redactCredentials } from './redact-credentials.js';

// Sanitize a single extension-network entry. Mirrors the two-layer
// approach in sanitize-har.js: known-name fields get redacted to
// '[REDACTED]', then a pattern pass via redactCredentials sweeps any
// remaining secret-shaped values (AWS keys, GitHub tokens, JWT, etc.).
// Extension entries don't carry headers in v1, so name-based redaction
// reduces to URL query params; the pattern pass covers request and
// response bodies plus the URL.

const SENSITIVE_QUERY_PARAMS = new Set([
  'access_token', 'auth', 'token', 'api_key', 'apikey',
  'password', 'secret', 'session', 'sessionid', 'sid',
  'authorization',
]);

function redactQueryParams(url) {
  if (typeof url !== 'string') return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let mutated = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, '[REDACTED]');
      mutated = true;
    }
  }
  return mutated ? parsed.toString() : url;
}

function redactString(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return redactCredentials(value);
}

export function sanitizeExtensionEntry(entry) {
  if (!entry) return entry;
  const out = { ...entry };
  out.url = redactString(redactQueryParams(out.url));
  if (out.requestBody) out.requestBody = redactString(out.requestBody);
  if (out.responseBody) out.responseBody = redactString(out.responseBody);
  return out;
}
