import { test, expect, describe } from 'vitest';
import { filterNetwork } from '../filter-network.js';

const entries = [
  { url: 'http://localhost:3456/api/data' },
  { url: 'https://fonts.googleapis.com/css' },
  { url: 'https://clerk.accounts.dev/v1/client' },
  { url: 'http://localhost:5173/src/main.jsx' },
];

describe('filterNetwork', () => {
  test('returns all entries when no filters configured', () => {
    const result = filterNetwork(entries, {});
    expect(result).toHaveLength(4);
  });

  test('includes only matching hosts', () => {
    const result = filterNetwork(entries, { includeHosts: ['localhost:3456'] });
    expect(result).toHaveLength(1);
    expect(result[0].url).toContain('localhost:3456');
  });

  test('includes multiple hosts', () => {
    const result = filterNetwork(entries, { includeHosts: ['localhost:3456', 'localhost:5173'] });
    expect(result).toHaveLength(2);
  });

  test('excludes matching hosts', () => {
    const result = filterNetwork(entries, { excludeHosts: ['fonts.googleapis.com', 'clerk.accounts.dev'] });
    expect(result).toHaveLength(2);
    expect(result.every((e) => !e.url.includes('googleapis') && !e.url.includes('clerk'))).toBe(true);
  });

  test('excludes blob URLs when include list is specified', () => {
    const withBlob = [...entries, { url: 'blob:http://localhost:5173/abc123' }];
    const result = filterNetwork(withBlob, { includeHosts: ['localhost:3456'] });
    expect(result).toHaveLength(1);
    expect(result[0].url).toContain('localhost:3456');
  });

  test('includes blob URLs when no include list', () => {
    const withBlob = [{ url: 'blob:http://localhost:5173/abc123' }];
    const result = filterNetwork(withBlob, { excludeHosts: ['fonts.googleapis.com'] });
    expect(result).toHaveLength(1);
  });
});
