import { test, expect, describe } from 'vitest';
import { formatNarration } from '../narration.js';

describe('formatNarration', () => {
  test('formats segments with timestamps', () => {
    const narration = {
      backend: 'whisper.cpp',
      transcript: 'Hello world. Now I click.',
      segments: [
        { text: 'Hello world.', startMs: 720, endMs: 2000 },
        { text: 'Now I click.', startMs: 5000, endMs: 7200 },
      ],
      words: [],
    };

    const result = formatNarration(narration);
    expect(result).toContain('# Narration');
    expect(result).toContain('whisper.cpp');
    expect(result).toContain('**[00:00]** Hello world.');
    expect(result).toContain('**[00:05]** Now I click.');
  });

  test('formats timestamps with minutes', () => {
    const narration = {
      backend: 'deepgram',
      transcript: 'Later segment',
      segments: [
        { text: 'Later segment', startMs: 125000, endMs: 130000 },
      ],
      words: [],
    };

    const result = formatNarration(narration);
    expect(result).toContain('**[02:05]** Later segment');
  });

  test('handles no segments but has words', () => {
    const narration = {
      backend: 'deepgram',
      transcript: 'Just words no segments',
      segments: [],
      words: [{ text: 'Just', startMs: 0, endMs: 200, confidence: 0.9 }],
    };

    const result = formatNarration(narration);
    expect(result).toContain('1 words transcribed');
    expect(result).toContain('Just words no segments');
  });

  test('handles empty narration', () => {
    const narration = {
      backend: 'whisper.cpp',
      transcript: '',
      segments: [],
      words: [],
    };

    const result = formatNarration(narration);
    expect(result).toContain('No narration transcribed');
  });
});
