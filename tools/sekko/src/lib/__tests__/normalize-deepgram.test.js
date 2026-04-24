import { test, expect, describe } from 'vitest';
import { normalizeDeepgram } from '../normalize-deepgram.js';

const FIXTURE = {
  results: {
    channels: [{
      alternatives: [{
        transcript: "I'm clicking the login button now",
        confidence: 0.98,
        words: [
          { word: "i'm", start: 0.08, end: 0.32, confidence: 0.99, punctuated_word: "I'm" },
          { word: 'clicking', start: 0.32, end: 0.72, confidence: 0.97, punctuated_word: 'clicking' },
          { word: 'the', start: 0.72, end: 0.88, confidence: 0.98, punctuated_word: 'the' },
          { word: 'login', start: 0.88, end: 1.2, confidence: 0.96, punctuated_word: 'login' },
          { word: 'button', start: 1.2, end: 1.6, confidence: 0.97, punctuated_word: 'button' },
          { word: 'now', start: 1.6, end: 2.0, confidence: 0.95, punctuated_word: 'now' },
        ],
      }],
    }],
    utterances: [
      { start: 0.08, end: 2.0, transcript: "I'm clicking the login button now", confidence: 0.98 },
    ],
  },
};

const AUDIO_START_EPOCH = 1712150400000;

describe('normalizeDeepgram', () => {
  test('produces normalized structure with correct fields', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);

    expect(result.backend).toBe('deepgram');
    expect(result.audioStartEpoch).toBe(AUDIO_START_EPOCH);
    expect(typeof result.transcript).toBe('string');
    expect(Array.isArray(result.words)).toBe(true);
    expect(Array.isArray(result.segments)).toBe(true);
  });

  test('converts word timestamps from seconds to milliseconds', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);

    expect(result.words[0]).toEqual({ text: "I'm", startMs: 80, endMs: 320, confidence: 0.99 });
    expect(result.words[1]).toEqual({ text: 'clicking', startMs: 320, endMs: 720, confidence: 0.97 });
    expect(result.words[5]).toEqual({ text: 'now', startMs: 1600, endMs: 2000, confidence: 0.95 });
  });

  test('uses punctuated_word when available', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);

    expect(result.words[0].text).toBe("I'm");
    expect(result.words[3].text).toBe('login');
  });

  test('falls back to word when punctuated_word is missing', () => {
    const noPunctuation = {
      results: {
        channels: [{
          alternatives: [{
            transcript: 'hello',
            words: [{ word: 'hello', start: 0.0, end: 0.5, confidence: 0.99 }],
          }],
        }],
      },
    };

    const result = normalizeDeepgram(noPunctuation, AUDIO_START_EPOCH);
    expect(result.words[0].text).toBe('hello');
  });

  test('preserves full transcript', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);
    expect(result.transcript).toBe("I'm clicking the login button now");
  });

  test('extracts utterances as segments', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({
      text: "I'm clicking the login button now",
      startMs: 80,
      endMs: 2000,
    });
  });

  test('handles missing utterances gracefully', () => {
    const noUtterances = {
      results: {
        channels: [{
          alternatives: [{
            transcript: 'hi',
            words: [{ word: 'hi', start: 0.0, end: 0.3, confidence: 0.99, punctuated_word: 'Hi' }],
          }],
        }],
      },
    };

    const result = normalizeDeepgram(noUtterances, AUDIO_START_EPOCH);
    expect(result.segments).toEqual([]);
    expect(result.words).toHaveLength(1);
  });

  test('produces same structure shape as whisper normalizer', () => {
    const result = normalizeDeepgram(FIXTURE, AUDIO_START_EPOCH);

    expect(result).toHaveProperty('transcript');
    expect(result).toHaveProperty('backend');
    expect(result).toHaveProperty('audioStartEpoch');
    expect(result).toHaveProperty('words');
    expect(result).toHaveProperty('segments');

    const word = result.words[0];
    expect(word).toHaveProperty('text');
    expect(word).toHaveProperty('startMs');
    expect(word).toHaveProperty('endMs');
    expect(word).toHaveProperty('confidence');
  });
});
