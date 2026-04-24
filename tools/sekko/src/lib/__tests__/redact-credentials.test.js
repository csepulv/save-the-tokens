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
