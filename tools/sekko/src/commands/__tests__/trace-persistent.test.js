import { test, expect, describe } from 'vitest';
import { existsSync, statSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';

describe('persistent context integration', () => {
  const outputDir = resolve(import.meta.dirname, '../../../.test-output/trace-persistent');
  const profileDir = resolve(outputDir, 'profile');

  function cleanOutput() {
    rmSync(outputDir, { recursive: true, force: true });
  }

  test('persistent context produces trace.zip and recording.har', async () => {
    cleanOutput();
    mkdirSync(outputDir, { recursive: true });

    const { chromium } = await import('playwright');

    const harPath = resolve(outputDir, 'recording.har');
    const tracePath = resolve(outputDir, 'trace.zip');

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      recordHar: { path: harPath },
      viewport: null,
    });
    await context.tracing.start({ screenshots: true, snapshots: true });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.goto('https://example.com');
    await page.close();

    await context.tracing.stop({ path: tracePath });
    await context.close();

    expect(existsSync(tracePath)).toBe(true);
    expect(statSync(tracePath).size).toBeGreaterThan(0);

    expect(existsSync(harPath)).toBe(true);
    const har = JSON.parse(readFileSync(harPath, 'utf-8'));
    const hasExampleRequest = har.log.entries.some(
      (entry) => entry.request.url.includes('example.com')
    );
    expect(hasExampleRequest).toBe(true);

    // Profile dir should exist and have content (Chromium writes to it)
    expect(existsSync(profileDir)).toBe(true);

    cleanOutput();
  }, 30_000);

  test('second run with same profile dir reuses it', async () => {
    cleanOutput();
    mkdirSync(outputDir, { recursive: true });

    const { chromium } = await import('playwright');

    // First run — sets a localStorage value
    const ctx1 = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: null,
    });
    const page1 = ctx1.pages()[0] || await ctx1.newPage();
    await page1.goto('https://example.com');
    await page1.evaluate(() => {
      localStorage.setItem('sekko-test', 'persisted');
    });
    await ctx1.close();

    // Second run — same profile dir, value should still be there
    const ctx2 = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: null,
    });
    const page2 = ctx2.pages()[0] || await ctx2.newPage();
    await page2.goto('https://example.com');
    const value = await page2.evaluate(() => localStorage.getItem('sekko-test'));
    await ctx2.close();

    expect(value).toBe('persisted');

    cleanOutput();
  }, 60_000);
});
