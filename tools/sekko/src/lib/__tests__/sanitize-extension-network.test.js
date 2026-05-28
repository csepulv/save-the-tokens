import { test, expect, describe } from 'vitest';
import { sanitizeExtensionEntry } from '../sanitize-extension-network.js';

describe('sanitizeExtensionEntry', () => {
  test('redacts sensitive query params in URL', () => {
    const entry = {
      url: 'https://api.example.com/x?access_token=abc123&q=hello',
      requestBody: null,
      responseBody: null,
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.url).toContain('access_token=%5BREDACTED%5D');
    expect(out.url).toContain('q=hello');
  });

  test('case-insensitive query-param matching', () => {
    const entry = {
      url: 'https://api.example.com/x?Token=abc',
      requestBody: null,
      responseBody: null,
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.url).not.toContain('abc');
  });

  test('redacts Bearer tokens in request body', () => {
    const entry = {
      url: 'https://api.example.com/',
      requestBody: 'Authorization: Bearer eyJhbGc.realsecret.signature',
      responseBody: null,
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.requestBody).not.toContain('realsecret');
    expect(out.requestBody).toContain('[REDACTED]');
  });

  test('redacts AWS keys in response body', () => {
    const entry = {
      url: 'https://api.example.com/',
      requestBody: null,
      responseBody: '{"key":"AKIAIOSFODNN7EXAMPLE"}',
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.responseBody).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out.responseBody).toContain('[REDACTED]');
  });

  test('redacts GitHub tokens', () => {
    const entry = {
      url: 'https://api.example.com/',
      requestBody: null,
      responseBody: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.responseBody).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(out.responseBody).toContain('[REDACTED]');
  });

  test('passes through clean entries unchanged', () => {
    const entry = {
      url: 'https://api.example.com/foo',
      requestBody: '{"normal":"data"}',
      responseBody: '{"result":42}',
      method: 'GET',
      status: 200,
    };
    const out = sanitizeExtensionEntry(entry);
    expect(out.url).toBe(entry.url);
    expect(out.requestBody).toBe(entry.requestBody);
    expect(out.responseBody).toBe(entry.responseBody);
    expect(out.method).toBe('GET');
    expect(out.status).toBe(200);
  });

  test('handles null bodies', () => {
    const entry = { url: 'https://api.example.com/', requestBody: null, responseBody: null };
    expect(() => sanitizeExtensionEntry(entry)).not.toThrow();
  });

  test('handles malformed URL gracefully', () => {
    const entry = { url: 'not a real url', requestBody: null, responseBody: null };
    const out = sanitizeExtensionEntry(entry);
    expect(out.url).toBe('not a real url');
  });

  test('returns entry unchanged when null/undefined', () => {
    expect(sanitizeExtensionEntry(null)).toBe(null);
    expect(sanitizeExtensionEntry(undefined)).toBe(undefined);
  });
});
