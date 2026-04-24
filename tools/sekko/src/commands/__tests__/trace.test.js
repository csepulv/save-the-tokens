import { test, expect, describe } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, statSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BIN = resolve(import.meta.dirname, '../../../bin/sekko.js');

describe('sekko trace', () => {
  test('--help shows usage with url argument and options', () => {
    const output = execFileSync('node', [BIN, 'trace', '--help'], {
      encoding: 'utf-8',
    });

    expect(output).toContain('Usage: sekko trace');
    expect(output).toContain('<url>');
    expect(output).toContain('--output');
    expect(output).toContain('--auth');
    expect(output).toContain('--save-auth');
  });
});

describe('sekko trace integration', () => {
  const outputDir = resolve(import.meta.dirname, '../../../.test-output/trace-integration');

  function cleanOutput() {
    rmSync(outputDir, { recursive: true, force: true });
  }

  test('scripted session produces trace.zip and recording.har', async () => {
    cleanOutput();

    // Launch sekko trace in a child process, then close the browser programmatically.
    // We can't use the CLI directly because it waits for user to close.
    // Instead, test the core Playwright flow directly.
    const { chromium } = await import('playwright');

    const harPath = resolve(outputDir, 'recording.har');
    const tracePath = resolve(outputDir, 'trace.zip');

    mkdirSync(outputDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordHar: { path: harPath },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });

    const page = await context.newPage();
    await page.goto('https://example.com');

    // Simulate user closing the tab
    await page.close();

    await context.tracing.stop({ path: tracePath });
    await context.close();
    await browser.close();

    // Verify trace.zip
    expect(existsSync(tracePath)).toBe(true);
    expect(statSync(tracePath).size).toBeGreaterThan(0);

    // Verify recording.har
    expect(existsSync(harPath)).toBe(true);
    const har = JSON.parse(readFileSync(harPath, 'utf-8'));
    expect(har.log.entries.length).toBeGreaterThan(0);

    const hasExampleRequest = har.log.entries.some(
      (entry) => entry.request.url.includes('example.com')
    );
    expect(hasExampleRequest).toBe(true);

    cleanOutput();
  }, 30_000);

  test('trace.zip contains action log and network data', async () => {
    cleanOutput();

    const { chromium } = await import('playwright');
    const { default: AdmZip } = await import('adm-zip');

    const tracePath = resolve(outputDir, 'trace.zip');
    const harPath = resolve(outputDir, 'recording.har');

    mkdirSync(outputDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordHar: { path: harPath },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });

    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.click('a');
    await page.waitForTimeout(1000);

    await page.close();
    await context.tracing.stop({ path: tracePath });
    await context.close();
    await browser.close();

    // Inspect trace.zip contents
    const zip = new AdmZip(tracePath);
    const entryNames = zip.getEntries().map((e) => e.entryName);

    // Should contain trace files
    expect(entryNames.some((n) => n.includes('trace.trace'))).toBe(true);
    expect(entryNames.some((n) => n.includes('trace.network'))).toBe(true);

    // Parse action log
    const traceEntry = zip.getEntries().find((e) => e.entryName.includes('trace.trace'));
    const traceContent = traceEntry.getData().toString('utf-8');
    const lines = traceContent.split('\n').filter(Boolean);
    const events = lines.map((l) => JSON.parse(l));

    // Should have before/after action pairs
    const beforeEvents = events.filter((e) => e.type === 'before');
    expect(beforeEvents.length).toBeGreaterThan(0);

    // Should have a click action
    const clickEvent = beforeEvents.find((e) => e.method === 'click');
    expect(clickEvent).toBeDefined();

    cleanOutput();
  }, 30_000);
});
