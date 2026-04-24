import { test, expect, describe, vi } from 'vitest';
import { checkDependencies } from '../setup.js';

function makeDeps({ recAvailable = true, whisperAvailable = true, modelExists = true } = {}) {
  return {
    execFileSync: vi.fn((cmd) => {
      if (cmd === 'rec' && !recAvailable) throw new Error('not found');
      if (cmd === 'whisper-cpp' && !whisperAvailable) throw new Error('not found');
    }),
    access: modelExists
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('ENOENT')),
  };
}

describe('checkDependencies', () => {
  test('all present', async () => {
    const status = await checkDependencies(makeDeps());
    expect(status.sox).toBe(true);
    expect(status.whisperCpp).toBe(true);
    expect(status.whisperModel).toBe(true);
    expect(status.modelPath).toContain('.sekko/models/ggml-small.en.bin');
  });

  test('nothing present', async () => {
    const status = await checkDependencies(makeDeps({
      recAvailable: false,
      whisperAvailable: false,
      modelExists: false,
    }));
    expect(status.sox).toBe(false);
    expect(status.whisperCpp).toBe(false);
    expect(status.whisperModel).toBe(false);
  });

  test('partial: sox present, whisper missing', async () => {
    const status = await checkDependencies(makeDeps({
      whisperAvailable: false,
      modelExists: false,
    }));
    expect(status.sox).toBe(true);
    expect(status.whisperCpp).toBe(false);
    expect(status.whisperModel).toBe(false);
  });

  test('partial: binaries present, model missing', async () => {
    const status = await checkDependencies(makeDeps({ modelExists: false }));
    expect(status.sox).toBe(true);
    expect(status.whisperCpp).toBe(true);
    expect(status.whisperModel).toBe(false);
  });
});
