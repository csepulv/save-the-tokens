import { writeFile, readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { getTranscriptionConfig } from '../lib/env-config.js';
import { transcribe } from '../lib/transcribe.js';
import { validateNarrationReady } from '../lib/preflight.js';

export async function transcribeCommand(audioFile, options) {
  const audioPath = resolve(audioFile);
  const outputDir = options.output ? resolve(options.output) : dirname(audioPath);

  const config = getTranscriptionConfig();
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

  const audioStartEpoch = await loadAudioStartEpoch(outputDir);

  console.log(`Transcribing ${audioPath} with ${config.transcriptionMode}...`);
  const narration = await transcribe(audioPath, audioStartEpoch, config);

  const outputPath = resolve(outputDir, 'narration.json');
  await writeFile(outputPath, JSON.stringify(narration, null, 2));
  console.log(`Transcription complete: ${outputPath}`);
  console.log(`  ${narration.words.length} words, ${narration.segments.length} segments`);
}

async function loadAudioStartEpoch(dir) {
  try {
    const metaPath = resolve(dir, 'voice-over-meta.json');
    const content = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(content);
    return meta.audioStartEpoch;
  } catch {
    return null;
  }
}
