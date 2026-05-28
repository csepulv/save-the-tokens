import { test, expect, describe } from 'vitest';
import { redactCredentials } from '../redact-credentials.js';

describe('redactCredentials', () => {
  test('redacts environment variable assignments', () => {
    expect(redactCredentials('GITHUB_TOKEN=ghp_abc123def456')).toBe('GITHUB_TOKEN=[REDACTED]');
    expect(redactCredentials('API_KEY=sk-1234567890')).toBe('API_KEY=[REDACTED]');
    expect(redactCredentials('SECRET=my_secret_value')).toBe('SECRET=[REDACTED]');
    expect(redactCredentials('PASSWORD=hunter2')).toBe('PASSWORD=[REDACTED]');
  });

  test('redacts AWS access keys', () => {
    expect(redactCredentials('AKIAIOSFODNN7EXAMPLE')).toBe('[REDACTED]');
  });

  test('redacts Bearer tokens', () => {
    expect(redactCredentials('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'))
      .toBe('Authorization: Bearer [REDACTED]');
  });

  test('redacts GitHub tokens', () => {
    expect(redactCredentials('ghp_abc123def456789012345678901234567890')).toBe('[REDACTED]');
    expect(redactCredentials('ghs_abc123def456')).toBe('[REDACTED]');
    expect(redactCredentials('github_pat_abc123')).toBe('[REDACTED]');
  });

  test('redacts basic auth in URLs', () => {
    expect(redactCredentials('https://user:password@example.com/api'))
      .toBe('https://[REDACTED]@example.com/api');
  });

  test('redacts private key blocks', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIBogI...\n-----END RSA PRIVATE KEY-----';
    expect(redactCredentials(key)).toBe('[REDACTED KEY BLOCK]');
  });

  test('redacts database connection strings', () => {
    expect(redactCredentials('postgres://admin:s3cret@db.example.com/mydb'))
      .toBe('postgres://[REDACTED]@db.example.com/mydb');
    expect(redactCredentials('mongodb://user:pass@mongo.host:27017/db'))
      .toBe('mongodb://[REDACTED]@mongo.host:27017/db');
  });

  describe('JWT redaction', () => {
    // JWTs surface in extension network response bodies (Clerk session
    // tokens, OAuth id_tokens, etc.) under various field names. The
    // structural pattern catches them regardless of where they sit.

    const sampleJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    test('redacts a bare JWT in plain text', () => {
      expect(redactCredentials(`token: ${sampleJwt}`)).toContain('[REDACTED JWT]');
      expect(redactCredentials(`token: ${sampleJwt}`)).not.toContain(sampleJwt);
    });

    test('redacts a JWT inside a JSON value', () => {
      const json = `{"jwt":"${sampleJwt}","other":"safe"}`;
      const out = redactCredentials(json);
      expect(out).not.toContain(sampleJwt);
      expect(out).toContain('[REDACTED JWT]');
      expect(out).toContain('"other":"safe"');
    });

    test('redacts a JWT in a URL query string', () => {
      const url = `https://api.example.com/x?id_token=${sampleJwt}&q=1`;
      const out = redactCredentials(url);
      expect(out).not.toContain(sampleJwt);
      expect(out).toContain('[REDACTED JWT]');
      expect(out).toContain('q=1');
    });

    test('redacts JWTs nested inside a Clerk-shaped JSON response', () => {
      // Mirrors the actual leak found in trace.zip page entries during
      // the trace-extensions M1 smoke (Clerk /v1/client response).
      const body = `{"sessions":[{"last_active_token":{"jwt":"${sampleJwt}"}}]}`;
      const out = redactCredentials(body);
      expect(out).not.toContain(sampleJwt);
      expect(out).toContain('[REDACTED JWT]');
    });

    test('redacts multiple JWTs in the same text', () => {
      const a = sampleJwt;
      const b = sampleJwt.replace('JohnDoe', 'JaneDoe');
      const out = redactCredentials(`first: ${a} second: ${b}`);
      expect(out).not.toContain(a);
      expect(out).not.toContain(b);
      const matches = out.match(/\[REDACTED JWT\]/g) || [];
      expect(matches.length).toBe(2);
    });

    test('does NOT redact a 2-segment string (incomplete; not a real JWT)', () => {
      // JWT requires three dot-separated segments. A 2-segment string
      // starting with eyJ is not a JWT.
      const incomplete = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ';
      expect(redactCredentials(incomplete)).toBe(incomplete);
    });

    test('does NOT redact short eyJ-prefixed strings without segments', () => {
      // Bare base64 starting with eyJ but no dot-separated segments
      // shouldn't match.
      expect(redactCredentials('eyJfoo')).toBe('eyJfoo');
      expect(redactCredentials('hello eyJabc world')).toBe('hello eyJabc world');
    });
  });

  test('does not redact non-matching text', () => {
    const safe = 'This is a normal command output\nwith no secrets at all\nHOST=localhost PORT=3000';
    // HOST and PORT don't match TOKEN|SECRET|PASSWORD|API_KEY patterns
    expect(redactCredentials(safe)).toBe(safe);
  });

  test('handles text with multiple credential types', () => {
    const input = [
      'GITHUB_TOKEN=ghp_abc123',
      'Authorization: Bearer eyJtoken',
      'postgres://admin:secret@db.host/mydb',
    ].join('\n');

    const result = redactCredentials(input);
    expect(result).not.toContain('ghp_abc123');
    expect(result).not.toContain('eyJtoken');
    expect(result).not.toContain(':secret@');
    expect(result).toContain('[REDACTED]');
  });
});
