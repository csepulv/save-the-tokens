import { execFile, spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { homedir } from 'os';
import { join, dirname, basename } from 'path';
import { createClient } from '@deepgram/sdk';
import { normalizeWhisper } from './normalize-whisper.js';
import { normalizeDeepgram } from './normalize-deepgram.js';

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL = 'ggml-small.en.bin';
const MODELS_DIR = join(homedir(), '.sekko', 'models');

export async function transcribe(audioPath, audioStartEpoch, config, deps = {}) {
  if (config.transcriptionMode === 'whisper') {
    return transcribeWithWhisper(audioPath, audioStartEpoch, config, deps);
  }
  return transcribeWithDeepgram(audioPath, audioStartEpoch, config, deps);
}

async function transcribeWithWhisper(audioPath, audioStartEpoch, config, deps = {}) {
  const { execFile: execFileFn = execFileAsync, readFile: readFileFn = readFile } = deps;
  const modelPath = getModelPath(config);

  // Compress to MP3 for faster processing and to handle oversized WAV files
  const inputPath = await compressIfNeeded(audioPath);
  const outputBase = join(dirname(audioPath), basename(audioPath, '.wav'));

  const binary = config.whisperBinary || 'whisper-cli';
  const args = [
    '-m', modelPath,
    '-f', inputPath,
    '-l', 'en',
    '-ojf',
    '-of', outputBase,
    '-bs', '8',
    '--best-of', '8',
    '--temperature', '0.2',
    '--no-prints',
    '-pp',
    '--no-speech-thold', '0.8',
    '--entropy-thold', '2.0',
  ];
  if (config.keyterms?.length) {
    args.push('--prompt', `This is a recording about: ${config.keyterms.join(', ')}`);
  }
  if (deps.execFile) {
    await deps.execFile(binary, args);
  } else {
    await runWithProgress(binary, args);
  }

  const jsonContent = await readFileFn(`${outputBase}.json`, 'utf-8');
  const whisperJson = JSON.parse(jsonContent);
  return normalizeWhisper(whisperJson, audioStartEpoch);
}

async function transcribeWithDeepgram(audioPath, audioStartEpoch, config, deps = {}) {
  const { deepgramTranscribe = callDeepgramSdk } = deps;

  const dgResponse = await deepgramTranscribe(audioPath, config);
  return normalizeDeepgram(dgResponse, audioStartEpoch);
}

async function callDeepgramSdk(audioPath, config) {
  const { readFileSync } = await import('fs');
  const filePath = audioPath.endsWith('.wav') ? await compressIfNeeded(audioPath) : audioPath;
  const buffer = readFileSync(filePath);
  const client = createClient(config.deepgramApiKey);
  const dgOptions = {
    model: 'nova-3',
    smart_format: true,
    utterances: true,
  };
  if (config.keyterms?.length) {
    dgOptions.keyterm = config.keyterms;
  }
  const { result, error } = await client.listen.prerecorded.transcribeFile(buffer, dgOptions);
  if (error) throw new Error(`Deepgram transcription failed: ${error.message || JSON.stringify(error)}`);
  return result;
}

async function compressIfNeeded(wavPath) {
  const mp3Path = wavPath.replace(/\.wav$/, '.mp3');
  try {
    const { existsSync } = await import('fs');
    if (existsSync(mp3Path)) return mp3Path;
    const { compressRecording } = await import('./audio-recorder.js');
    return await compressRecording(wavPath);
  } catch {
    return wavPath;
  }
}

function runWithProgress(binary, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function getModelPath(config) {
  return config.whisperModelPath || join(MODELS_DIR, DEFAULT_MODEL);
}
