import { test, expect, describe } from 'vitest';
import { getTranscriptionConfig } from '../env-config.js';

describe('getTranscriptionConfig', () => {
  test('returns defaults when env vars not set', () => {
    const config = getTranscriptionConfig({});
    expect(config.transcriptionMode).toBe('whisper');
    expect(config.deepgramApiKey).toBeNull();
  });

  test('reads transcription mode from env', () => {
    const config = getTranscriptionConfig({ SEKKO_TRANSCRIPTION_MODE: 'deepgram' });
    expect(config.transcriptionMode).toBe('deepgram');
  });

  test('reads Deepgram API key from env', () => {
    const config = getTranscriptionConfig({ DEEPGRAM_API_KEY: 'dg_abc' });
    expect(config.deepgramApiKey).toBe('dg_abc');
  });

  test('reads both values together', () => {
    const config = getTranscriptionConfig({
      SEKKO_TRANSCRIPTION_MODE: 'deepgram',
      DEEPGRAM_API_KEY: 'dg_abc',
    });
    expect(config.transcriptionMode).toBe('deepgram');
    expect(config.deepgramApiKey).toBe('dg_abc');
  });
});
