import { test, expect, describe } from 'vitest';
import { normalizeWhisper } from '../normalize-whisper.js';

const FIXTURE = {
  transcription: [
    {
      timestamps: { from: '00:00:00,720', to: '00:00:04,500' },
      offsets: { from: 720, to: 4500 },
      text: ' And then I click the submit button',
      tokens: [
        { text: ' And', timestamps: { from: '00:00:00,720', to: '00:00:01,040' }, offsets: { from: 720, to: 1040 }, id: 400, p: 0.92 },
        { text: ' then', timestamps: { from: '00:00:01,040', to: '00:00:01,280' }, offsets: { from: 1040, to: 1280 }, id: 550, p: 0.88 },
        { text: ' I', timestamps: { from: '00:00:01,280', to: '00:00:01,400' }, offsets: { from: 1280, to: 1400 }, id: 286, p: 0.95 },
        { text: ' click', timestamps: { from: '00:00:01,400', to: '00:00:01,800' }, offsets: { from: 1400, to: 1800 }, id: 2502, p: 0.91 },
        { text: ' the', timestamps: { from: '00:00:01,800', to: '00:00:02,000' }, offsets: { from: 1800, to: 2000 }, id: 262, p: 0.97 },
        { text: ' submit', timestamps: { from: '00:00:02,000', to: '00:00:02,800' }, offsets: { from: 2000, to: 2800 }, id: 9502, p: 0.89 },
        { text: ' button', timestamps: { from: '00:00:02,800', to: '00:00:04,500' }, offsets: { from: 2800, to: 4500 }, id: 4568, p: 0.93 },
      ],
    },
    {
      timestamps: { from: '00:00:05,000', to: '00:00:07,200' },
      offsets: { from: 5000, to: 7200 },
      text: ' Now the form is saved',
      tokens: [
        { text: ' Now', offsets: { from: 5000, to: 5300 }, id: 823, p: 0.90 },
        { text: ' the', offsets: { from: 5300, to: 5500 }, id: 262, p: 0.96 },
        { text: ' form', offsets: { from: 5500, to: 5900 }, id: 1296, p: 0.87 },
        { text: ' is', offsets: { from: 5900, to: 6100 }, id: 307, p: 0.94 },
        { text: ' saved', offsets: { from: 6100, to: 7200 }, id: 8232, p: 0.91 },
      ],
    },
  ],
};

const AUDIO_START_EPOCH = 1712150400000;

describe('normalizeWhisper', () => {
  test('produces normalized structure with correct fields', () => {
    const result = normalizeWhisper(FIXTURE, AUDIO_START_EPOCH);

    expect(result.backend).toBe('whisper.cpp');
    expect(result.audioStartEpoch).toBe(AUDIO_START_EPOCH);
    expect(typeof result.transcript).toBe('string');
    expect(Array.isArray(result.words)).toBe(true);
    expect(Array.isArray(result.segments)).toBe(true);
  });

  test('extracts all words with trimmed text', () => {
    const result = normalizeWhisper(FIXTURE, AUDIO_START_EPOCH);

    expect(result.words).toHaveLength(12);
    expect(result.words[0]).toEqual({ text: 'And', startMs: 720, endMs: 1040, confidence: 0.92 });
    expect(result.words[6]).toEqual({ text: 'button', startMs: 2800, endMs: 4500, confidence: 0.93 });
    expect(result.words[7]).toEqual({ text: 'Now', startMs: 5000, endMs: 5300, confidence: 0.90 });
  });

  test('builds transcript from segment text', () => {
    const result = normalizeWhisper(FIXTURE, AUDIO_START_EPOCH);

    expect(result.transcript).toBe('And then I click the submit button Now the form is saved');
  });

  test('extracts segments with timestamps', () => {
    const result = normalizeWhisper(FIXTURE, AUDIO_START_EPOCH);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual({
      text: 'And then I click the submit button',
      startMs: 720,
      endMs: 4500,
    });
    expect(result.segments[1]).toEqual({
      text: 'Now the form is saved',
      startMs: 5000,
      endMs: 7200,
    });
  });

  test('filters special tokens (id >= 50257)', () => {
    const withSpecial = {
      transcription: [{
        offsets: { from: 0, to: 1000 },
        text: ' Hello',
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 }, id: 50364, p: 0.99 },
          { text: ' Hello', offsets: { from: 0, to: 500 }, id: 2425, p: 0.95 },
          { text: '[_TT_250]', offsets: { from: 500, to: 1000 }, id: 50613, p: 0.99 },
        ],
      }],
    };

    const result = normalizeWhisper(withSpecial, AUDIO_START_EPOCH);
    expect(result.words).toHaveLength(1);
    expect(result.words[0].text).toBe('Hello');
  });

  test('filters empty text tokens after trimming', () => {
    const withEmpty = {
      transcription: [{
        offsets: { from: 0, to: 500 },
        text: ' Hi',
        tokens: [
          { text: '  ', offsets: { from: 0, to: 100 }, id: 220, p: 0.50 },
          { text: ' Hi', offsets: { from: 100, to: 500 }, id: 1038, p: 0.95 },
        ],
      }],
    };

    const result = normalizeWhisper(withEmpty, AUDIO_START_EPOCH);
    expect(result.words).toHaveLength(1);
    expect(result.words[0].text).toBe('Hi');
  });
});
