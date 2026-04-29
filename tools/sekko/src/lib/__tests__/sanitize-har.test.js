import { test, expect, describe } from 'vitest';
import { sanitizeHarFile } from '../sanitize-har.js';

const buildHar = () => ({
  log: {
    version: '1.2',
    creator: { name: 'sekko', version: '1.0.0' },
    entries: [
      {
        startedDateTime: '2024-01-01T00:00:00.000Z',
        time: 12,
        request: {
          method: 'POST',
          url: 'https://api.example.com/login?token=abc123&user=joe',
          headers: [
            { name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig' },
            { name: 'Cookie', value: 'session=secret123; theme=light' },
            { name: 'X-API-Key', value: 'ghp_realtoken12345678901234567890' },
            { name: 'Content-Type', value: 'application/json' },
          ],
          cookies: [{ name: 'session', value: 'secret123' }],
          postData: {
            mimeType: 'application/json',
            text: '{"access_token":"abc","note":"see AKIAIOSFODNN7EXAMPLE for details"}',
          },
        },
        response: {
          status: 200,
          headers: [
            { name: 'Set-Cookie', value: 'session=newval; Path=/' },
            { name: 'X-Trace-Id', value: 'no secrets here' },
          ],
          cookies: [],
          content: {
            mimeType: 'application/json',
            text: '{"msg":"deploy with ghp_anothertoken12345678901234567890"}',
          },
        },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
      },
    ],
  },
});

const makeMemoryFs = (initial) => {
  const files = new Map(Object.entries(initial));
  return {
    readFile: async (path) => {
      if (!files.has(path)) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(path);
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    files,
  };
};

describe('sanitizeHarFile', () => {
  test('redacts Authorization Bearer header value', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    const auth = out.log.entries[0].request.headers.find((h) => h.name === 'Authorization');
    expect(auth.value).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(auth.value).toMatch(/^Bearer (obfuscated|\[REDACTED\])$/);
  });

  test('redacts request Cookie and response Set-Cookie', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    const cookie = out.log.entries[0].request.headers.find((h) => h.name === 'Cookie');
    expect(cookie.value).not.toContain('secret123');
    expect(cookie.value).toContain('session=obfuscated');
    const setCookie = out.log.entries[0].response.headers.find((h) => h.name === 'Set-Cookie');
    expect(setCookie.value).toContain('session=obfuscated');
  });

  test('redacts request URL token query param', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    expect(out.log.entries[0].request.url).not.toContain('abc123');
    expect(out.log.entries[0].request.url).toMatch(/token=(obfuscated|\[REDACTED\])/);
  });

  test('redacts request postData access_token field', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    const body = JSON.parse(out.log.entries[0].request.postData.text);
    expect(body.access_token).toBe('obfuscated');
  });

  test('redacts secret-shaped values in non-standard headers via pattern pass', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    const apiKey = out.log.entries[0].request.headers.find((h) => h.name === 'X-API-Key');
    expect(apiKey.value).toBe('[REDACTED]');
  });

  test('redacts AWS keys and GitHub tokens in body content via pattern pass', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    expect(out.log.entries[0].request.postData.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out.log.entries[0].request.postData.text).toContain('[REDACTED]');
    expect(out.log.entries[0].response.content.text).not.toContain('ghp_anothertoken');
    expect(out.log.entries[0].response.content.text).toContain('[REDACTED]');
  });

  test('preserves structure (entry count, header names, request method)', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    expect(out.log.entries).toHaveLength(1);
    expect(out.log.entries[0].request.method).toBe('POST');
    const headerNames = out.log.entries[0].request.headers.map((h) => h.name);
    expect(headerNames).toEqual(['Authorization', 'Cookie', 'X-API-Key', 'Content-Type']);
    expect(out.log.entries[0].response.status).toBe(200);
  });

  test('leaves non-sensitive header values untouched', async () => {
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(buildHar()) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    const contentType = out.log.entries[0].request.headers.find((h) => h.name === 'Content-Type');
    expect(contentType.value).toBe('application/json');
    const traceId = out.log.entries[0].response.headers.find((h) => h.name === 'X-Trace-Id');
    expect(traceId.value).toBe('no secrets here');
  });

  test('handles HAR with no entries', async () => {
    const empty = { log: { version: '1.2', creator: { name: 'x', version: '1' }, entries: [] } };
    const fs = makeMemoryFs({ '/har.json': JSON.stringify(empty) });
    await sanitizeHarFile('/har.json', fs);
    const out = JSON.parse(fs.files.get('/har.json'));
    expect(out.log.entries).toEqual([]);
  });

  test('rethrows ENOENT (caller decides whether absence is an error)', async () => {
    const fs = makeMemoryFs({});
    await expect(sanitizeHarFile('/missing.har', fs)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
