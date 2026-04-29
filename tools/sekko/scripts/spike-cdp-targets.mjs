#!/usr/bin/env node
// Spike: log CDP Target.* events during a browser session.
//
// Goal: determine whether MV3 toolbar popups (which Playwright's
// context.on('page') doesn't fire for) surface as CDP targets when
// observed at the raw protocol layer.
//
// Usage:
//   node scripts/spike-cdp-targets.mjs <url> \
//     [--load-extension <path>] \
//     [--user-data-dir <path> | --profile <name>]
//
// Example (matching Chris's smoke flow):
//   node scripts/spike-cdp-targets.mjs https://v3.junkdrawer.io \
//     --profile jd \
//     --load-extension /Users/chris/workspace/junkdrawer/apps/browser-extension/dist/production

import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';

function parseArgs(argv) {
  const out = { url: null, loadExtension: null, userDataDir: null, profile: null };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--load-extension') { out.loadExtension = argv[++i]; }
    else if (a === '--user-data-dir') { out.userDataDir = argv[++i]; }
    else if (a === '--profile') { out.profile = argv[++i]; }
    else if (!out.url && !a.startsWith('--')) { out.url = a; }
    i++;
  }
  if (!out.url) {
    console.error('Usage: node scripts/spike-cdp-targets.mjs <url> [--load-extension <path>] [--user-data-dir <path> | --profile <name>]');
    process.exit(1);
  }
  return out;
}

function resolveProfileDir(args) {
  if (args.userDataDir) return resolve(args.userDataDir);
  if (args.profile) {
    const dir = join(homedir(), '.sekko', 'profiles', args.profile);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return mkdtempSync(join(tmpdir(), 'sekko-cdp-spike-'));
}

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function summarize(targetInfo) {
  return {
    type: targetInfo.type,
    url: targetInfo.url || '(empty)',
    title: targetInfo.title || '',
    targetId: targetInfo.targetId,
    attached: targetInfo.attached,
    browserContextId: targetInfo.browserContextId,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profileDir = resolveProfileDir(args);
  const isTemp = !args.userDataDir && !args.profile;

  const launchArgs = [];
  if (args.loadExtension) {
    const extPath = resolve(args.loadExtension);
    launchArgs.push(`--disable-extensions-except=${extPath}`);
    launchArgs.push(`--load-extension=${extPath}`);
  }

  console.log(`[${ts()}] launching chromium`);
  console.log(`[${ts()}] profile dir: ${profileDir}${isTemp ? ' (temp; will be deleted)' : ''}`);
  if (args.loadExtension) console.log(`[${ts()}] extension:   ${args.loadExtension}`);
  console.log(`[${ts()}] url:         ${args.url}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: launchArgs,
  });

  // Open the CDP session against a real page (newCDPSession needs a target).
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);

  let createdCount = 0;
  let destroyedCount = 0;
  let changedCount = 0;

  cdp.on('Target.targetCreated', (params) => {
    createdCount++;
    console.log(`[${ts()}] CREATED   #${createdCount}`, JSON.stringify(summarize(params.targetInfo)));
  });
  cdp.on('Target.targetDestroyed', (params) => {
    destroyedCount++;
    console.log(`[${ts()}] DESTROYED #${destroyedCount}`, params.targetId);
  });
  cdp.on('Target.targetInfoChanged', (params) => {
    changedCount++;
    // Only log if URL or type changed materially (skip noise)
    const info = summarize(params.targetInfo);
    if (info.url && info.url !== '(empty)' && info.url !== 'about:blank') {
      console.log(`[${ts()}] CHANGED   #${changedCount}`, JSON.stringify(info));
    }
  });

  // ALSO listen on Playwright's filtered page event, for comparison
  context.on('page', (newPage) => {
    console.log(`[${ts()}] PW PAGE   url=${newPage.url()}`);
  });

  console.log(`[${ts()}] enabling Target.setDiscoverTargets...`);
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  console.log(`[${ts()}] discover enabled. Logging all target events.`);

  console.log(`[${ts()}] navigating to ${args.url}`);
  await page.goto(args.url);

  console.log('');
  console.log('Browser is open. Click your extension toolbar icon to open the popup,');
  console.log('then close the page (or browser) when done. Target events will print above.');
  console.log('');

  // Wait until ALL pages closed (sekko-style boundary)
  await new Promise((resolvePromise) => {
    const checkClose = () => {
      if (context.pages().length === 0) resolvePromise();
    };
    page.on('close', checkClose);
    context.on('page', (newPage) => {
      newPage.on('close', checkClose);
    });
  });

  console.log('');
  console.log(`[${ts()}] session ended.`);
  console.log(`  CREATED:   ${createdCount}`);
  console.log(`  DESTROYED: ${destroyedCount}`);
  console.log(`  CHANGED:   ${changedCount}`);

  await context.close();
  if (isTemp) rmSync(profileDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
