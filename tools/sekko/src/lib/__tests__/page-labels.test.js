import { test, expect, describe } from 'vitest';
import { derivePageLabel, isExtensionUrl } from '../page-labels.js';

describe('isExtensionUrl', () => {
  test('detects chrome-extension://', () => {
    expect(isExtensionUrl('chrome-extension://abc123/popup.html')).toBe(true);
  });

  test('returns false for regular URLs', () => {
    expect(isExtensionUrl('https://example.com/foo')).toBe(false);
    expect(isExtensionUrl('http://localhost:3000/')).toBe(false);
    expect(isExtensionUrl('about:blank')).toBe(false);
  });

  test('handles non-strings gracefully', () => {
    expect(isExtensionUrl(null)).toBe(false);
    expect(isExtensionUrl(undefined)).toBe(false);
    expect(isExtensionUrl(123)).toBe(false);
  });
});

describe('derivePageLabel', () => {
  test('returns null for regular pages', () => {
    expect(derivePageLabel('https://example.com/')).toBe(null);
    expect(derivePageLabel('http://localhost/foo')).toBe(null);
    expect(derivePageLabel('about:blank')).toBe(null);
  });

  test('labels popup', () => {
    expect(derivePageLabel('chrome-extension://abc123/popup.html')).toBe('popup');
  });

  test('labels index.html as popup (Vite/webpack convention)', () => {
    expect(derivePageLabel('chrome-extension://abc123/index.html')).toBe('popup');
  });

  test('labels sidepanel', () => {
    expect(derivePageLabel('chrome-extension://abc123/sidepanel.html')).toBe('sidepanel');
  });

  test('labels options', () => {
    expect(derivePageLabel('chrome-extension://abc123/options.html')).toBe('options');
    expect(derivePageLabel('chrome-extension://abc123/options_page.html')).toBe('options');
  });

  test('falls back to "ext" for unknown extension page', () => {
    expect(derivePageLabel('chrome-extension://abc/devtools.html')).toBe('ext');
    expect(derivePageLabel('chrome-extension://abc/some-other-page.html')).toBe('ext');
  });

  test('handles query params and hashes in URL', () => {
    expect(derivePageLabel('chrome-extension://abc/popup.html?x=1')).toBe('popup');
    expect(derivePageLabel('chrome-extension://abc/popup.html#section')).toBe('popup');
  });

  test('handles malformed extension URL', () => {
    expect(derivePageLabel('chrome-extension://')).toBe('ext');
  });
});
