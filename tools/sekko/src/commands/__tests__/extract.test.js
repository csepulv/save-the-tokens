import { test, expect, describe } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BIN = resolve(import.meta.dirname, '../../../bin/sekko.js');

describe('sekko extract', () => {
  test('--help shows usage with trace argument and options', () => {
    const output = execFileSync('node', [BIN, 'extract', '--help'], {
      encoding: 'utf-8',
    });

    expect(output).toContain('Usage: sekko extract');
    expect(output).toContain('<trace>');
    expect(output).toContain('--output');
  });
});

describe('sekko extract integration', () => {
  const fixtureDir = resolve(import.meta.dirname, '../../../.test-output/extract-fixture');
  const extractDir = resolve(import.meta.dirname, '../../../.test-output/extract-output');

  async function generateFixtureTrace() {
    rmSync(fixtureDir, { recursive: true, force: true });
    mkdirSync(fixtureDir, { recursive: true });

    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordHar: { path: resolve(fixtureDir, 'recording.har') },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });

    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.click('a');
    await page.waitForTimeout(1000);

    await page.close();
    await context.tracing.stop({ path: resolve(fixtureDir, 'trace.zip') });
    await context.close();
    await browser.close();
  }

  function cleanExtractOutput() {
    rmSync(extractDir, { recursive: true, force: true });
  }

  test('extracts all artifacts from a trace', async () => {
    await generateFixtureTrace();
    cleanExtractOutput();

    execFileSync('node', [BIN, 'extract', resolve(fixtureDir, 'trace.zip'), '--output', extractDir], {
      encoding: 'utf-8',
    });

    // All artifact files exist
    expect(existsSync(resolve(extractDir, 'actions.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'network.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'selectors.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'summary.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'screenshots'))).toBe(true);

    // Actions has content
    const actions = readFileSync(resolve(extractDir, 'actions.md'), 'utf-8');
    expect(actions).toContain('# Actions');
    expect(actions).toContain('Navigate to https://example.com');

    // Network has the example.com request
    const network = readFileSync(resolve(extractDir, 'network.md'), 'utf-8');
    expect(network).toContain('example.com');

    // Selectors has the link click
    const selectors = readFileSync(resolve(extractDir, 'selectors.md'), 'utf-8');
    expect(selectors).toContain('# Selectors');

    // Screenshots directory exists (may be empty for scripted traces with no user events)
    expect(existsSync(resolve(extractDir, 'screenshots'))).toBe(true);

    // network-detail.json exists
    expect(existsSync(resolve(extractDir, 'network-detail.json'))).toBe(true);
    const detail = JSON.parse(readFileSync(resolve(extractDir, 'network-detail.json'), 'utf-8'));
    expect(detail.length).toBeGreaterThan(0);
    expect(detail[0]).toHaveProperty('id');
    expect(detail[0]).toHaveProperty('requestBody');

    // Summary references all artifacts
    const summary = readFileSync(resolve(extractDir, 'summary.md'), 'utf-8');
    expect(summary).toContain('actions.md');
    expect(summary).toContain('network.md');
    expect(summary).toContain('network-detail.json');
    expect(summary).toContain('selectors.md');
    expect(summary).toContain('screenshots/');

    cleanExtractOutput();
    rmSync(fixtureDir, { recursive: true, force: true });
  }, 30_000);

  test('handles minimal trace (page load only, no interactions)', async () => {
    rmSync(fixtureDir, { recursive: true, force: true });
    mkdirSync(fixtureDir, { recursive: true });

    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });

    const page = await context.newPage();
    await page.goto('https://example.com');

    await page.close();
    await context.tracing.stop({ path: resolve(fixtureDir, 'trace.zip') });
    await context.close();
    await browser.close();

    cleanExtractOutput();

    execFileSync('node', [BIN, 'extract', resolve(fixtureDir, 'trace.zip'), '--output', extractDir], {
      encoding: 'utf-8',
    });

    // All files exist even for minimal trace
    expect(existsSync(resolve(extractDir, 'actions.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'network.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'selectors.md'))).toBe(true);
    expect(existsSync(resolve(extractDir, 'summary.md'))).toBe(true);

    // Actions shows the navigation
    const actions = readFileSync(resolve(extractDir, 'actions.md'), 'utf-8');
    expect(actions).toContain('Navigate to https://example.com');

    cleanExtractOutput();
    rmSync(fixtureDir, { recursive: true, force: true });
  }, 30_000);
});
