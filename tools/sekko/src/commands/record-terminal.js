import { mkdir, writeFile, stat } from 'fs/promises';
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { resolve } from 'path';
import { startTerminalRecording } from '../lib/pty-recorder.js';
import { startRecording, stopRecording, compressRecording } from '../lib/audio-recorder.js';
import { validateNarrationReady } from '../lib/preflight.js';
import { getTranscriptionConfig } from '../lib/env-config.js';
import { transcribe } from '../lib/transcribe.js';

export async function recordTerminal(options) {
  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  const shell = detectShell(options.shell);

  if (shell === 'bash') {
    console.warn('Note: zsh provides millisecond timestamp precision for better action correlation. Using bash (second precision).');
  }

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

    const cleanup = () => { if (audioController) stopRecording(audioController).catch(() => {}); };
    process.on('exit', cleanup);
    process.on('uncaughtException', cleanup);
    process.on('unhandledRejection', cleanup);
  }

  console.log(`Recording terminal session (${shell}). Type 'exit' or Ctrl-D to stop.`);

  const { castPath, durationMs } = await startTerminalRecording({ shell, outputDir });

  // Stop audio recording
  if (audioController) {
    const audioMeta = await stopRecording(audioController);
    let audioFile = 'voice-over.wav';
    try {
      await compressRecording(audioMeta.outputPath);
      audioFile = 'voice-over.mp3';
    } catch { /* ffmpeg not available */ }
    const metaPath = resolve(outputDir, 'voice-over-meta.json');
    await writeFile(metaPath, JSON.stringify({
      audioStartEpoch: audioMeta.audioStartEpoch,
      audioFile,
    }, null, 2));
  }

  const durationSec = Math.round(durationMs / 1000);
  console.log(`\nSession recorded: ${castPath} (${durationSec}s)`);

  if (audioController && config) {
    await promptTranscription(outputDir, config);
  }
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
  } catch { /* ok */ }

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
  return new Promise((res) => {
    rl.question(question, (answer) => { rl.close(); res(answer || ''); });
  });
}

function detectShell(override) {
  if (override) return override;
  try {
    execFileSync('zsh', ['--version'], { stdio: 'pipe' });
    return 'zsh';
  } catch {
    return 'bash';
  }
}
