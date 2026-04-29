import { test, expect, describe } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('--connect mode plumbing', () => {
  test('connectOverCDP attaches to a Chromium with debug port and produces a trace', async () => {
    const port = 9233; // specific port to avoid collisions
    const debugProfile = mkdtempSync(join(tmpdir(), 'sekko-cdp-debug-'));
    const recordingDir = mkdtempSync(join(tmpdir(), 'sekko-cdp-recording-'));
    const tracePath = join(recordingDir, 'trace.zip');

    try {
      const { chromium } = await import('playwright');

      // Step 1: launch Chromium with remote debugging port enabled.
      // launchPersistentContext lets us pass extra args.
      const debugContext = await chromium.launchPersistentContext(debugProfile, {
        headless: true,
        args: [`--remote-debugging-port=${port}`],
      });

      try {
        // Step 2: connect over CDP. This is what sekko's --connect does.
        const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
        expect(browser.isConnected()).toBe(true);

        const ctx = browser.contexts()[0];
        expect(ctx).toBeTruthy();

        // Step 3: open a fresh tab and exercise tracing on the attached context.
        await ctx.tracing.start({ screenshots: true, snapshots: true });
        const page = await ctx.newPage();
        await page.goto('https://example.com/');
        await page.waitForLoadState('networkidle');
        await ctx.tracing.stop({ path: tracePath });

        expect(existsSync(tracePath)).toBe(true);

        // Step 4: detach. The debug Chromium should remain alive.
        await page.close();
        await browser.close();
        expect(browser.isConnected()).toBe(false);

        // The debug context still has its (other) pages — the connect
        // didn't take it down.
        expect(debugContext.pages().length).toBeGreaterThan(0);
      } finally {
        await debugContext.close();
      }
    } finally {
      rmSync(debugProfile, { recursive: true, force: true });
      rmSync(recordingDir, { recursive: true, force: true });
    }
  }, 60_000);
});
