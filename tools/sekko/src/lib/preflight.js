import { execFileSync } from 'child_process';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_MODEL = 'ggml-small.en.bin';
const MODELS_DIR = join(homedir(), '.sekko', 'models');

export async function validateNarrationReady(config = {}, deps = {}) {
  const { execFileSync: execSync = execFileSync, access: accessFn = access } = deps;
  const errors = [];

  if (!checkBinaryAvailable('rec', execSync)) {
    errors.push("SoX not found. Run 'sekko setup' to install dependencies.");
  }

  const mode = config.transcriptionMode || 'whisper';

  if (mode === 'whisper') {
    const whisperBin = config.whisperBinary || 'whisper-cli';
    if (!checkBinaryAvailable(whisperBin, execSync)) {
      errors.push(`${whisperBin} not found. Install with 'brew install whisper-cpp' or set SEKKO_WHISPER_CLI in .env.`);
    }

    const modelPath = config.whisperModelPath || join(MODELS_DIR, DEFAULT_MODEL);
    try {
      await accessFn(modelPath);
    } catch {
      errors.push(`Whisper model not found at ${modelPath}. Run 'sekko setup' to download.`);
    }
  } else if (mode === 'deepgram') {
    if (!config.deepgramApiKey) {
      errors.push("DEEPGRAM_API_KEY not set. Add it to your .env file or run 'sekko setup'.");
    }
  }

  return { ready: errors.length === 0, errors };
}

function checkBinaryAvailable(name, execSync) {
  try {
    execSync(name, ['--help'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

