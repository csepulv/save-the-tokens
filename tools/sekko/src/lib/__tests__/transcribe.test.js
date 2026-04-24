import { test, expect, describe, vi } from 'vitest';
import { transcribe } from '../transcribe.js';
import { homedir } from 'os';
import { join } from 'path';

const MODELS_DIR = join(homedir(), '.sekko', 'models');
const DEFAULT_MODEL_PATH = join(MODELS_DIR, 'ggml-small.en.bin');

const WHISPER_OUTPUT = {
  transcription: [
    {
      offsets: { from: 100, to: 2000 },
      text: ' Hello world',
      tokens: [
        { text: ' Hello', offsets: { from: 100, to: 500 }, id: 2425, p: 0.95 },
        { text: ' world', offsets: { from: 500, to: 2000 }, id: 1002, p: 0.92 },
      ],
    },
  ],
};

describe('transcribe', () => {
  test('whisper: calls whisper-cpp and normalizes output', async () => {
    const deps = {
      execFile: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      readFile: vi.fn().mockResolvedValue(JSON.stringify(WHISPER_OUTPUT)),
    };
    const config = { transcriptionMode: 'whisper' };

    const result = await transcribe('/tmp/voice-over.wav', 1000, config, deps);

    expect(deps.execFile).toHaveBeenCalledWith('whisper-cli', expect.arrayContaining([
      '-m', DEFAULT_MODEL_PATH,
      '-f', '/tmp/voice-over.wav',
      '-l', 'en',
      '-ojf',
      '-of', '/tmp/voice-over',
    ]));
    expect(deps.readFile).toHaveBeenCalledWith('/tmp/voice-over.json', 'utf-8');
    expect(result.backend).toBe('whisper.cpp');
    expect(result.audioStartEpoch).toBe(1000);
    expect(result.words).toHaveLength(2);
    expect(result.transcript).toBe('Hello world');
  });

  test('whisper: uses custom model path when configured', async () => {
    const deps = {
      execFile: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      readFile: vi.fn().mockResolvedValue(JSON.stringify(WHISPER_OUTPUT)),
    };
    const config = { transcriptionMode: 'whisper', whisperModelPath: '/custom/model.bin' };

    await transcribe('/tmp/voice-over.wav', 1000, config, deps);

    expect(deps.execFile).toHaveBeenCalledWith('whisper-cli', expect.arrayContaining([
      '-m', '/custom/model.bin',
    ]));
  });

  test('deepgram: calls transcribe function and normalizes output', async () => {
    const dgResponse = {
      results: {
        channels: [{
          alternatives: [{
            transcript: 'Hello world',
            words: [
              { word: 'hello', start: 0.1, end: 0.5, confidence: 0.95, punctuated_word: 'Hello' },
              { word: 'world', start: 0.5, end: 1.0, confidence: 0.92, punctuated_word: 'world' },
            ],
          }],
        }],
      },
    };

    const deps = {
      deepgramTranscribe: vi.fn().mockResolvedValue(dgResponse),
    };
    const config = { transcriptionMode: 'deepgram', deepgramApiKey: 'dg_test' };

    const result = await transcribe('/tmp/voice-over.wav', 2000, config, deps);

    expect(deps.deepgramTranscribe).toHaveBeenCalledWith('/tmp/voice-over.wav', config);
    expect(result.backend).toBe('deepgram');
    expect(result.audioStartEpoch).toBe(2000);
    expect(result.words).toHaveLength(2);
    expect(result.transcript).toBe('Hello world');
  });
});
