import { execFileSync } from 'child_process';
import { access, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const DEFAULT_MODEL = 'ggml-small.en.bin';
const MODELS_DIR = join(homedir(), '.sekko', 'models');
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL}`;

export async function checkDependencies(deps = {}) {
  const { execFileSync: execSync = execFileSync, access: accessFn = access } = deps;

  return {
    sox: checkBinary('rec', execSync),
    whisperCpp: checkBinary('whisper-cpp', execSync),
    whisperModel: await checkFileExists(join(MODELS_DIR, DEFAULT_MODEL), accessFn),
    modelPath: join(MODELS_DIR, DEFAULT_MODEL),
    modelUrl: MODEL_URL,
  };
}

export async function runSetup(deps = {}) {
  const status = await checkDependencies(deps);
  const { prompt: promptFn = prompt, execFileSync: execSync = execFileSync, mkdir: mkdirFn = mkdir } = deps;

  console.log('\nsekko setup\n');

  if (status.sox) {
    console.log('  OK: SoX (rec) installed');
  } else {
    console.log('  MISSING: SoX (rec) not found');
    console.log('    Install with: brew install sox');
    const answer = await promptFn('    Install now? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      console.log('    Running: brew install sox');
      try {
        execSync('brew', ['install', 'sox'], { stdio: 'inherit' });
        console.log('    OK: SoX installed');
      } catch {
        console.error('    FAILED: Install manually with: brew install sox');
      }
    }
  }

  if (status.whisperCpp) {
    console.log('  OK: whisper-cpp installed');
  } else {
    console.log('  MISSING: whisper-cpp not found');
    console.log('    Install with: brew install whisper-cpp');
    const answer = await promptFn('    Install now? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      console.log('    Running: brew install whisper-cpp');
      try {
        execSync('brew', ['install', 'whisper-cpp'], { stdio: 'inherit' });
        console.log('    OK: whisper-cpp installed');
      } catch {
        console.error('    FAILED: Install manually with: brew install whisper-cpp');
      }
    }
  }

  if (status.whisperModel) {
    console.log(`  OK: Whisper model at ${status.modelPath}`);
  } else {
    console.log('  MISSING: Whisper model not found');
    const answer = await promptFn(`    Download ${DEFAULT_MODEL} (466 MB)? [Y/n] `);
    if (answer.toLowerCase() !== 'n') {
      await downloadModel(status.modelPath, status.modelUrl, { execFileSync: execSync, mkdir: mkdirFn });
    }
  }

  console.log('\nSetup complete.\n');
}

async function downloadModel(targetPath, url, deps = {}) {
  const { execFileSync: execSync = execFileSync, mkdir: mkdirFn = mkdir } = deps;
  await mkdirFn(join(homedir(), '.sekko', 'models'), { recursive: true });

  console.log(`    Downloading to ${targetPath}...`);
  try {
    execSync('curl', ['-L', '-o', targetPath, url], { stdio: 'inherit' });
    console.log('    OK: Model downloaded');
  } catch {
    console.error('    FAILED: Download manually from:');
    console.error(`      ${url}`);
  }
}

function checkBinary(name, execSync) {
  try {
    execSync(name, ['--help'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function checkFileExists(path, accessFn) {
  try {
    await accessFn(path);
    return true;
  } catch {
    return false;
  }
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || '');
    });
  });
}
