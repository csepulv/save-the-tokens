import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { USER_EVENT_INIT_SCRIPT, startEventPolling } from '../lib/user-events.js';
import { startRecording, stopRecording, compressRecording } from '../lib/audio-recorder.js';
import { validateNarrationReady } from '../lib/preflight.js';
import { getTranscriptionConfig } from '../lib/env-config.js';
import { transcribe } from '../lib/transcribe.js';
import { planTraceLaunch } from '../lib/trace-options.js';
import { ensureProfilePath } from '../lib/profile-paths.js';
import { startSystemScreencap, getBrowserWindowRegion } from '../lib/system-screencap.js';
import { sanitizeHarFile } from '../lib/sanitize-har.js';
import { startExtensionCapture } from '../lib/cdp-extension-capture.js';
import { sanitizeExtensionEntry } from '../lib/sanitize-extension-network.js';

export async function trace(url, options) {
  let plan;
  try {
    plan = planTraceLaunch(options);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  for (const warning of plan.warnings) {
    console.warn(warning);
  }

  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  const tracePath = resolve(outputDir, 'trace.zip');
  const harPath = resolve(outputDir, 'recording.har');
  const eventsPath = resolve(outputDir, 'user-events.json');
  const sysShotsDir = resolve(outputDir, 'system-screenshots');
  const extensionNetworkPath = resolve(outputDir, 'extension-network.json');

  // Narration pre-flight
  let audioController = null;
  let config = null;
  if (options.narrate) {
    config = getTranscriptionConfig();
    if (options.keyterm) {
      config.keyterms = options.keyterm.split(',').map((t) => t.trim());
    }
    const validation = await validateNarrationReady(config);
    if (!validation.ready) {
      for (const error of validation.errors) {
        console.error(`Error: ${error}`);
      }
      process.exit(1);
    }
    const audioPath = resolve(outputDir, 'voice-over.wav');
    audioController = startRecording(audioPath, { stat });
    console.log('Recording voice-over... (speak into your microphone)');

    // Ensure rec is killed on any exit — prevents orphaned mic access
    const cleanup = () => { if (audioController) stopRecording(audioController).catch(() => {}); };
    process.on('exit', cleanup);
    process.on('uncaughtException', cleanup);
    process.on('unhandledRejection', cleanup);
  }

  // HAR is only available in modes where sekko creates the context.
  // Connect mode attaches to an existing context that wasn't started
  // with recordHar; trace.zip's network data covers the same ground.
  const recordHar = plan.mode === 'connect' ? null : harPath;

  const { context, browser } = await launchContext({ plan, options, recordHar });

  // Inject user event capture into every page
  await context.addInitScript(USER_EVENT_INIT_SCRIPT);

  await context.tracing.start({ screenshots: true, snapshots: true });

  // In connect mode, always open a fresh tab to avoid attaching to a
  // tab the user already has open. Other modes reuse the first page.
  let page;
  if (plan.mode === 'connect') {
    page = await context.newPage();
  } else {
    page = context.pages()[0] || await context.newPage();
  }
  console.log(`Recording trace — browse ${url}, then close the browser to finish.`);
  await page.goto(url);

  const { screencap, regionRefreshTimer } = plan.useSystemScreenshots
    ? await setupSystemScreencap(page, sysShotsDir)
    : { screencap: null, regionRefreshTimer: null };

  // Optional comprehensive extension recording — capture network from
  // service workers and extension pages (popup/sidepanel/options) via CDP.
  // Spec: docs/sekko/epics/trace-extensions/. Empirically validated by
  // scripts/spike-cdp-sw-network.mjs (2026-04-29).
  const extensionCapture = plan.traceExtensions
    ? await startExtensionCapture({
        context,
        page,
        sanitize: options.sanitize === false ? (e) => e : sanitizeExtensionEntry,
      })
    : null;

  // Track which pages belong to this recording session. New pages opened
  // during the session (popups, sidepanels) are added; user-opened tabs
  // outside the session in connect mode aren't tracked.
  const ownedPages = new Set([page]);

  // Start polling for user events
  const poller = startEventPolling(context);

  await attachExtensionPopupDetection(context, page, poller);

  let saveTriggered = false;
  let stopReason = null;

  const saveAndExit = async (reason) => {
    if (saveTriggered) return;
    saveTriggered = true;
    stopReason = reason;
    poller.stop();
    if (screencap) screencap.stop();
    if (regionRefreshTimer) clearInterval(regionRefreshTimer);

    try {
      // Audio first — if it's running, finalize it
      if (audioController) {
        const audioMeta = await stopRecording(audioController);
        let audioFile = 'voice-over.wav';
        try {
          await compressRecording(audioMeta.outputPath);
          audioFile = 'voice-over.mp3';
          console.log('Voice-over compressed to MP3.');
        } catch {
          console.log('ffmpeg not available — keeping WAV.');
        }
        const metaPath = resolve(outputDir, 'voice-over-meta.json');
        await writeFile(metaPath, JSON.stringify({
          audioStartEpoch: audioMeta.audioStartEpoch,
          audioFile,
        }, null, 2));
      }

      if (plan.useSaveAuth) {
        const authPath = resolve(options.saveAuth);
        const storageState = await context.storageState();
        await writeFile(authPath, JSON.stringify(storageState, null, 2));
        console.log(`Auth state saved to ${authPath}`);
      }

      // Save user events first — pure file I/O independent of any browser
      // state. Writing this last would lose events if browser teardown
      // throws (which happens occasionally in connect mode).
      const events = poller.getEvents();
      await writeFile(eventsPath, JSON.stringify(events, null, 2));

      // Drain extension capture — sanitization happens inside, then we
      // serialize. Run before tracing.stop so any pending body fetches
      // get a chance against the still-live CDP session.
      if (extensionCapture) {
        try {
          const result = await extensionCapture.stop();
          if (result.count > 0) {
            await writeFile(
              extensionNetworkPath,
              JSON.stringify(result.entries, null, 2)
            );
            console.log(`Extension network: ${result.count} entries from ${result.sessionsAttached} target(s) → ${extensionNetworkPath}`);
          }
        } catch (e) {
          console.error(`Warning: extension network capture failed to drain: ${e.message}`);
        }
      }

      await context.tracing.stop({ path: tracePath });

      // For connect mode, don't close the context — it belongs to the
      // user's running browser. Just detach from CDP.
      if (plan.mode !== 'connect') {
        await context.close(); // also flushes HAR
      }

      if (recordHar) {
        if (options.sanitize !== false) {
          try {
            await sanitizeHarFile(recordHar);
            console.log('Sanitized recording.har');
          } catch (e) {
            console.error(`Warning: HAR sanitization failed: ${e.message}`);
          }
        } else {
          console.log('Skipped HAR sanitization (--no-sanitize).');
        }
      }
    } catch (e) {
      console.error('Warning: could not save trace cleanly:', e.message);
    }

    try {
      if (browser) {
        await browser.close(); // CDP browser.close() detaches without quitting
      }
    } catch (e) {
      console.error('Warning: could not close browser cleanly:', e.message);
    }
  };

  await new Promise((resolvePromise) => {
    const onPageClose = async () => {
      const stillOpen = [...ownedPages].some((p) => !p.isClosed());
      if (stillOpen) return;
      await saveAndExit('page-close');
      resolvePromise();
    };

    page.on('close', onPageClose);
    context.on('page', (newPage) => {
      ownedPages.add(newPage);
      newPage.on('close', onPageClose);

      // Synthesize a "page-opened" action so new tabs/popups land in
      // user-events.json. Without this, popups have no associated
      // action and the screenshot correlator can't surface them.
      newPage.once('domcontentloaded', () => {
        try {
          const newUrl = newPage.url();
          if (!newUrl || newUrl === 'about:blank') return;
          // chrome-extension URLs are handled by the CDP target listener
          // — skip here to avoid double-counting if a future Playwright
          // version starts surfacing extension popups as pages.
          if (newUrl.startsWith('chrome-extension://')) return;
          poller.inject({
            type: 'page-opened',
            timestamp: Date.now(),
            selector: null,
            tag: null,
            text: null,
            url: newUrl,
          });
        } catch {
          // page may have closed already — ignore
        }
      });
    });

    // Stop signal: Ctrl-C in launching terminal.
    process.on('SIGINT', async () => {
      console.log('\nReceived Ctrl-C, saving session...');
      await saveAndExit('sigint');
      resolvePromise();
    });

    // Stop signal: connected browser disconnects (Canary quits) or
    // the launched browser dies. Either way we save what we have.
    if (browser) {
      browser.on('disconnected', async () => {
        if (saveTriggered) return;
        console.log(`\nBrowser disconnected, saving partial session...`);
        await saveAndExit('disconnected');
        resolvePromise();
      });
    }
  });

  const eventCount = poller.getEvents().length;
  const outputLines = [tracePath];
  if (recordHar) outputLines.push(harPath);
  outputLines.push(`${eventsPath} (${eventCount} user events)`);
  if (screencap) {
    outputLines.push(`${sysShotsDir} (${screencap.getCount()} system screenshots)`);
  }
  if (audioController) {
    outputLines.push(resolve(outputDir, 'voice-over.wav') + ' (+ .mp3 if ffmpeg available)');
    outputLines.push(resolve(outputDir, 'voice-over-meta.json'));
  }
  console.log(`\nTrace complete (stop reason: ${stopReason}). Output:\n  ${outputLines.join('\n  ')}`);

  if (audioController && config) {
    await promptTranscription(outputDir, config);
  }

  process.exit(stopReason === 'disconnected' ? 1 : 0);
}

// Opt-in system-level screencapture. Captures the browser window (so
// extension popups attached to the toolbar are visible but other apps
// on screen aren't). Replaces — at extract time — the default
// Playwright page-area screenshots. Requires Screen Recording
// permission; adds ~3 MB/min of disk cost.
async function setupSystemScreencap(page, sysShotsDir) {
  await mkdir(sysShotsDir, { recursive: true });
  const initialRegion = await getBrowserWindowRegion(page);
  if (initialRegion) {
    console.log(`Screencapture bounded to browser window (${initialRegion.w}x${initialRegion.h} at ${initialRegion.x},${initialRegion.y})`);
  } else {
    console.log('Screencapture: window bounds unavailable, falling back to full display');
  }
  const screencap = startSystemScreencap({ outputDir: sysShotsDir, region: initialRegion });

  // Refresh window bounds periodically so resized/moved windows stay
  // framed correctly. Cheap; one page.evaluate per tick.
  const regionRefreshTimer = setInterval(async () => {
    const refreshed = await getBrowserWindowRegion(page);
    if (refreshed) screencap.updateRegion(refreshed);
  }, 5000);

  return { screencap, regionRefreshTimer };
}

// Detect MV3 extension popups via raw CDP target events. Playwright's
// context.on('page') filter doesn't fire for popups that come up as
// unattached page-type targets, but Target.targetInfoChanged does.
// When we see a chrome-extension://...page target, synthesize a
// page-opened action so the screenshot correlator has a timestamp to
// attach the popup-state system screenshot to.
async function attachExtensionPopupDetection(context, page, poller) {
  try {
    const cdpSession = await context.newCDPSession(page);
    const seenExtensionTargets = new Set();
    const handleTarget = (targetInfo) => {
      if (!targetInfo || targetInfo.type !== 'page') return;
      const url = targetInfo.url;
      if (!url || !url.startsWith('chrome-extension://')) return;
      if (seenExtensionTargets.has(targetInfo.targetId)) return;
      seenExtensionTargets.add(targetInfo.targetId);
      poller.inject({
        type: 'page-opened',
        timestamp: Date.now(),
        selector: null,
        tag: null,
        text: null,
        url,
      });
    };
    cdpSession.on('Target.targetCreated', (params) => handleTarget(params.targetInfo));
    cdpSession.on('Target.targetInfoChanged', (params) => handleTarget(params.targetInfo));
    cdpSession.on('Target.targetDestroyed', (params) => {
      seenExtensionTargets.delete(params.targetId);
    });
    await cdpSession.send('Target.setDiscoverTargets', { discover: true });
  } catch (e) {
    console.warn(`Warning: could not enable CDP target discovery (${e.message}); extension popups may not be detected.`);
  }
}

async function launchContext({ plan, options, recordHar }) {
  const launchArgs = [];
  if (plan.extensions.length > 0) {
    launchArgs.push(`--disable-extensions-except=${plan.extensions.join(',')}`);
    launchArgs.push(`--load-extension=${plan.extensions.join(',')}`);
  }

  const contextOptions = {
    viewport: plan.viewport, // null = track window
  };
  if (recordHar) contextOptions.recordHar = { path: recordHar };

  if (plan.mode === 'connect') {
    console.log(`Connecting to ${plan.connectUrl} ...`);
    let browser;
    try {
      browser = await chromium.connectOverCDP(plan.connectUrl);
    } catch (err) {
      console.error(`Error: could not connect to ${plan.connectUrl} — ${err.message}`);
      console.error('');
      console.error('Verify the target browser is running with --remote-debugging-port enabled, e.g.:');
      console.error('  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \\');
      console.error('    --remote-debugging-port=9222');
      console.error('');
      console.error('Then check it responds:');
      console.error('  curl http://127.0.0.1:9222/json/version');
      process.exit(1);
    }
    const context = browser.contexts()[0] || await browser.newContext();
    return { context, browser };
  }

  if (plan.persistencePath) {
    await ensureProfilePath(plan.persistencePath);
    console.log(`Using profile at ${plan.persistencePath}`);
    if (plan.extensions.length > 0) {
      console.log(`Loading extensions: ${plan.extensions.join(', ')}`);
    }
    const context = await chromium.launchPersistentContext(plan.persistencePath, {
      headless: false,
      args: launchArgs,
      ...contextOptions,
    });
    return { context, browser: null };
  }

  if (plan.useAuth) {
    contextOptions.storageState = resolve(options.auth);
  }
  const browser = await chromium.launch({ headless: false, args: launchArgs });
  const context = await browser.newContext(contextOptions);
  return { context, browser };
}

async function promptTranscription(outputDir, config) {
  const answer = await askQuestion('Transcribe narration now? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    console.log(`Skipped. Run 'node bin/sekko.js transcribe ${resolve(outputDir, 'voice-over.wav')}' later.`);
    return;
  }

  const audioPath = resolve(outputDir, 'voice-over.wav');
  const metaPath = resolve(outputDir, 'voice-over-meta.json');

  let audioStartEpoch = null;
  try {
    const { readFile } = await import('fs/promises');
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    audioStartEpoch = meta.audioStartEpoch;
  } catch {
    // metadata may not exist
  }

  console.log(`Transcribing with ${config.transcriptionMode}...`);
  try {
    const narration = await transcribe(audioPath, audioStartEpoch, config);
    const narrationPath = resolve(outputDir, 'narration.json');
    await writeFile(narrationPath, JSON.stringify(narration, null, 2));
    console.log(`Transcription saved: ${narrationPath} (${narration.words.length} words)`);
  } catch (e) {
    console.error(`Transcription failed: ${e.message}`);
    console.log(`Run 'node bin/sekko.js transcribe ${resolve(outputDir, 'voice-over.wav')}' to retry.`);
  }
}

function askQuestion(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer || '');
    });
  });
}
