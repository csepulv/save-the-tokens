import { test, expect, describe } from 'vitest';
import { formatNetwork } from '../network.js';

describe('formatNetwork', () => {
  test('formats detail entries as summary table with IDs', () => {
    const entries = [
      { id: 1, method: 'GET', url: 'https://example.com/', status: 200, durationMs: 150, mimeType: 'text/html', actionIndex: null },
    ];

    const md = formatNetwork(entries);
    expect(md).toContain('# Network');
    expect(md).toContain('network-detail.json');
    expect(md).toContain('| 1 |');
    expect(md).toContain('GET');
    expect(md).toContain('200');
    expect(md).toContain('150ms');
    expect(md).toContain('html');
  });

  test('does not contain inline request/response bodies', () => {
    const entries = [
      { id: 1, method: 'POST', url: 'https://api.example.com/data', status: 200, durationMs: 50, mimeType: 'application/json', requestBody: '{"q":"test"}', responseBody: '{"items":[]}', actionIndex: null },
    ];

    const md = formatNetwork(entries);
    expect(md).not.toContain('Request body');
    expect(md).not.toContain('Response body');
    expect(md).not.toContain('{"q":"test"}');
  });

  test('shows action correlation in table', () => {
    const entries = [
      { id: 1, method: 'POST', url: 'https://api.example.com/search', status: 200, durationMs: 30, mimeType: 'application/json', actionIndex: 7 },
    ];

    const md = formatNetwork(entries);
    expect(md).toContain('#7');
  });

  test('shows dash for uncorrelated requests', () => {
    const entries = [
      { id: 1, method: 'GET', url: 'https://example.com/', status: 200, durationMs: 100, mimeType: 'text/html', actionIndex: null },
    ];

    const md = formatNetwork(entries);
    expect(md).toContain('| — |');
  });

  test('shows empty state for no requests', () => {
    const md = formatNetwork([]);
    expect(md).toContain('No network requests captured');
  });
});
