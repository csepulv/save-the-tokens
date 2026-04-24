import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { USER_EVENT_INIT_SCRIPT, startEventPolling } from '../lib/user-events.js';
import { startRecording, stopRecording, compressRecording } from '../lib/audio-recorder.js';
import { validateNarrationReady } from '../lib/preflight.js';
import { getTranscriptionConfig } from '../lib/env-config.js';
import { transcribe } from '../lib/transcribe.js';

export async function trace(url, options) {
  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  const tracePath = resolve(outputDir, 'trace.zip');
  const harPath = resolve(outputDir, 'recording.har');
  const eventsPath = resolve(outputDir, 'user-events.json');

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

  const contextOptions = {
    recordHar: { path: harPath },
  };

  if (options.auth) {
    contextOptions.storageState = resolve(options.auth);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(contextOptions);

  // Inject user event capture into every page
  await context.addInitScript(USER_EVENT_INIT_SCRIPT);

  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  console.log(`Recording trace — browse ${url}, then close the browser to finish.`);
  await page.goto(url);

  // Start polling for user events
  const poller = startEventPolling(context);

  // When the user closes the browser, page close fires before browser disconnect.
  // We save trace + HAR + user events in that window.
  await new Promise((resolvePromise) => {
    const onPageClose = async () => {
      if (context.pages().length > 0) return;

      poller.stop();

      try {
        // Stop audio recording and compress before saving other artifacts
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

        if (options.saveAuth) {
          const authPath = resolve(options.saveAuth);
          const storageState = await context.storageState();
          await writeFile(authPath, JSON.stringify(storageState, null, 2));
          console.log(`Auth state saved to ${authPath}`);
        }

        await context.tracing.stop({ path: tracePath });
        await context.close(); // flushes HAR

        // Save user events
        const events = poller.getEvents();
        await writeFile(eventsPath, JSON.stringify(events, null, 2));
      } catch (e) {
        console.error('Warning: could not save trace cleanly:', e.message);
      }

      resolvePromise();
    };

    page.on('close', onPageClose);
    context.on('page', (newPage) => {
      newPage.on('close', onPageClose);
    });
  });

  const eventCount = poller.getEvents().length;
  const outputLines = [tracePath, harPath, `${eventsPath} (${eventCount} user events)`];
  if (audioController) {
    outputLines.push(resolve(outputDir, 'voice-over.wav') + ' (+ .mp3 if ffmpeg available)');
    outputLines.push(resolve(outputDir, 'voice-over-meta.json'));
  }
  console.log(`\nTrace complete. Output:\n  ${outputLines.join('\n  ')}`);

  if (audioController && config) {
    await promptTranscription(outputDir, config);
  }

  process.exit(0);
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
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || '');
    });
  });
}
