import { execFile, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SOX_ARGS = ['-q', '-r', '16000', '-c', '1', '-b', '16'];
const MIC_CHECK_DELAY_MS = 2000;
const WAV_HEADER_SIZE = 44;
const STOP_TIMEOUT_MS = 2000;

export function checkSoxAvailable(deps = {}) {
  const { execFileSync: execSync = execFileSync } = deps;
  try {
    execSync('rec', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function startRecording(outputPath, deps = {}) {
  const { spawn: spawnFn = spawn, stat } = deps;

  const audioStartEpoch = Date.now();
  const process = spawnFn('rec', [...SOX_ARGS, outputPath], { stdio: 'pipe' });

  let micWarningTimer = null;
  let warned = false;

  if (stat) {
    micWarningTimer = setTimeout(async () => {
      try {
        const stats = await stat(outputPath);
        if (stats.size <= WAV_HEADER_SIZE) {
          warned = true;
          console.warn(
            'Warning: No audio detected. Check that your terminal has microphone permission:\n' +
            '  System Settings > Privacy & Security > Microphone'
          );
        }
      } catch {
        // file may not exist yet
      }
    }, MIC_CHECK_DELAY_MS);
  }

  return {
    process,
    audioStartEpoch,
    outputPath,
    micWarningTimer,
    hasWarned: () => warned,
  };
}

export async function stopRecording(controller) {
  const { process, audioStartEpoch, outputPath, micWarningTimer } = controller;

  if (micWarningTimer) clearTimeout(micWarningTimer);

  if (process.exitCode !== null) {
    return { audioStartEpoch, outputPath };
  }

  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      process.kill('SIGKILL');
    }, STOP_TIMEOUT_MS);

    process.on('exit', () => {
      clearTimeout(killTimer);
      resolve({ audioStartEpoch, outputPath });
    });

    process.kill('SIGTERM');
  });
}

export async function compressRecording(wavPath, deps = {}) {
  const { execFile: execFileFn = execFileAsync } = deps;
  const mp3Path = wavPath.replace(/\.wav$/, '.mp3');
  await execFileFn('ffmpeg', ['-i', wavPath, '-ac', '1', '-ar', '16000', '-b:a', '64k', '-y', mp3Path]);
  return mp3Path;
}
