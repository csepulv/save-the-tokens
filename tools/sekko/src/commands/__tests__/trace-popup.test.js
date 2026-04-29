import { test, expect, describe } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { USER_EVENT_INIT_SCRIPT, startEventPolling } from '../../lib/user-events.js';
import { extract } from '../extract.js';

const FIXTURE_DIR = resolve(import.meta.dirname, '../../../test-fixtures/popup-extension');

describe('popup capture integration', () => {
  test('extension popup interactions land in extract output', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'sekko-popup-profile-'));
    const recordingDir = mkdtempSync(join(tmpdir(), 'sekko-popup-recording-'));
    const extractDir = mkdtempSync(join(tmpdir(), 'sekko-popup-extract-'));

    const tracePath = join(recordingDir, 'trace.zip');
    const harPath = join(recordingDir, 'recording.har');
    const eventsPath = join(recordingDir, 'user-events.json');

    try {
      const { chromium } = await import('playwright');

      const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: null,
        recordHar: { path: harPath },
        args: [
          `--disable-extensions-except=${FIXTURE_DIR}`,
          `--load-extension=${FIXTURE_DIR}`,
        ],
      });

      // Wait for service worker so we can read the extension ID.
      let sw = context.serviceWorkers()[0];
      if (!sw) {
        sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      }
      const extensionId = new URL(sw.url()).host;

      await context.addInitScript(USER_EVENT_INIT_SCRIPT);
      await context.tracing.start({ screenshots: true, snapshots: true });

      const poller = startEventPolling(context);

      // Drive the main page first so we have a non-popup baseline.
      const mainPage = context.pages()[0] || await context.newPage();
      await mainPage.goto('https://example.com/');
      await mainPage.waitForLoadState('networkidle');

      // Open the popup directly. addInitScript runs in this page too,
      // so any clicks inside the popup are captured in user-events.
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await popupPage.waitForSelector('[data-testid="popup-trigger"]');
      // Wait for the on-load fetch to settle
      await popupPage.waitForFunction(
        () => document.querySelector('[data-testid="popup-status"]')?.textContent.startsWith('load:'),
        null,
        { timeout: 10_000 }
      );

      // Click and wait for the click-driven fetch to also complete
      const responsePromise = popupPage.waitForResponse(
        (resp) => resp.url() === 'https://example.com/?clicked=1',
        { timeout: 10_000 }
      );
      await popupPage.click('[data-testid="popup-trigger"]');
      await responsePromise;
      // Give the user-events poller (500ms interval) at least one chance
      // to drain the click event before the popup closes.
      await popupPage.waitForTimeout(800);

      await popupPage.close();
      await mainPage.close();

      poller.stop();
      const events = poller.getEvents();
      writeFileSync(eventsPath, JSON.stringify(events, null, 2));

      await context.tracing.stop({ path: tracePath });
      await context.close();

      // Run the extract pipeline on the produced trace
      await extract(tracePath, { output: extractDir });

      // Assertions: the screenshots dir should contain a popup-suffixed file
      const screenshotsDir = join(extractDir, 'screenshots');
      const shotFiles = readdirSync(screenshotsDir);
      const popupShots = shotFiles.filter((f) => f.endsWith('-popup.jpeg'));
      expect(popupShots.length).toBeGreaterThan(0);

      // actions.md should mention "popup" as a page label
      const actionsMd = readFileSync(join(extractDir, 'actions.md'), 'utf-8');
      expect(actionsMd).toMatch(/\| popup \|/);

      // network-detail.json should contain the popup-driven fetch
      const networkDetailPath = join(extractDir, 'network-detail.json');
      expect(existsSync(networkDetailPath)).toBe(true);
      const networkDetail = JSON.parse(readFileSync(networkDetailPath, 'utf-8'));
      const clickedFetch = networkDetail.find(
        (entry) => entry.url === 'https://example.com/?clicked=1'
      );
      expect(clickedFetch).toBeDefined();
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(recordingDir, { recursive: true, force: true });
      rmSync(extractDir, { recursive: true, force: true });
    }
  }, 90_000);
});
