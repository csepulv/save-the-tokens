import { readFile, writeFile } from 'fs/promises';
import { sanitize } from 'har-sanitizer';
import { redactCredentials } from './redact-credentials.js';

// har-sanitizer redacts known sensitive fields by name (cookies,
// Authorization, Set-Cookie, Referer, Location, plus body/URL fields
// like access_token, password, email). It misses secret-shaped values
// in non-standard headers (e.g. X-API-Key) and arbitrary body text
// (AWS keys, GitHub tokens). The pattern pass below catches those.

const SANITIZE_OPTIONS = {
  cookies: 'obfuscate',
  tokens: 'obfuscate',
  salt: false,
};

export async function sanitizeHarFile(harPath, deps = {}) {
  const {
    readFile: read = readFile,
    writeFile: write = writeFile,
    sanitize: sanitizeFn = sanitize,
  } = deps;

  const raw = await read(harPath, 'utf-8');
  const har = JSON.parse(raw);
  const structurallySanitized = await sanitizeFn(har, SANITIZE_OPTIONS);
  const fullySanitized = redactPatternsInHar(structurallySanitized);
  await write(harPath, JSON.stringify(fullySanitized, null, 2));
}

function redactPatternsInHar(har) {
  if (!har?.log?.entries) return har;
  return {
    ...har,
    log: { ...har.log, entries: har.log.entries.map(redactEntry) },
  };
}

function redactEntry(entry) {
  return {
    ...entry,
    request: redactRequest(entry.request),
    response: redactResponse(entry.response),
  };
}

function redactRequest(request) {
  if (!request) return request;
  return {
    ...request,
    url: typeof request.url === 'string' ? redactCredentials(request.url) : request.url,
    headers: mapHeaders(request.headers),
    postData: redactTextField(request.postData),
  };
}

function redactResponse(response) {
  if (!response) return response;
  return {
    ...response,
    headers: mapHeaders(response.headers),
    content: redactTextField(response.content),
  };
}

function mapHeaders(headers) {
  if (!Array.isArray(headers)) return headers;
  return headers.map((h) =>
    h && typeof h.value === 'string' ? { ...h, value: redactCredentials(h.value) } : h
  );
}

function redactTextField(field) {
  if (!field || typeof field.text !== 'string') return field;
  return { ...field, text: redactCredentials(field.text) };
}
