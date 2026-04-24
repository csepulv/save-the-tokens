import { test, expect, describe, vi } from 'vitest';
import { validateNarrationReady } from '../preflight.js';
import { homedir } from 'os';
import { join } from 'path';

const MODEL_PATH = join(homedir(), '.sekko', 'models', 'ggml-small.en.bin');

function makeDeps({ recAvailable = true, whisperAvailable = true, modelExists = true } = {}) {
  const execSync = vi.fn((cmd) => {
    if (cmd === 'rec' && !recAvailable) throw new Error('not found');
    if (cmd === 'whisper-cli' && !whisperAvailable) throw new Error('not found');
  });
  const access = modelExists
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error('ENOENT'));
  return { execFileSync: execSync, access };
}

describe('validateNarrationReady', () => {
  test('passes when all deps are available (whisper mode)', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'whisper' },
      makeDeps()
    );
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when SoX not found', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'whisper' },
      makeDeps({ recAvailable: false })
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('SoX not found'),
    ]));
  });

  test('fails when whisper binary not found', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'whisper' },
      makeDeps({ whisperAvailable: false })
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('whisper-cli not found'),
    ]));
  });

  test('fails when whisper model not found', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'whisper' },
      makeDeps({ modelExists: false })
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Whisper model not found'),
    ]));
  });

  test('collects multiple errors', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'whisper' },
      makeDeps({ recAvailable: false, whisperAvailable: false, modelExists: false })
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  test('passes for deepgram when API key is set', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'deepgram', deepgramApiKey: 'dg_test' },
      makeDeps()
    );
    expect(result.ready).toBe(true);
  });

  test('fails for deepgram when API key is missing', async () => {
    const result = await validateNarrationReady(
      { transcriptionMode: 'deepgram', deepgramApiKey: null },
      makeDeps()
    );
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('DEEPGRAM_API_KEY'),
    ]));
  });

  test('defaults to whisper mode when not specified', async () => {
    const deps = makeDeps({ whisperAvailable: false });
    const result = await validateNarrationReady({}, deps);
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('whisper-cli'),
    ]));
  });
});
