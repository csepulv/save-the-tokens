import { resolve } from 'path';
import { unlink } from 'fs/promises';
import { createCastWriter } from './cast-writer.js';
import { writeHookFile } from './shell-hooks.js';

export async function startTerminalRecording({ shell, outputDir }, deps = {}) {
  const { importPty = () => import('node-pty') } = deps;
  const pty = await importPty();

  const castPath = resolve(outputDir, 'recording.cast');
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;

  const writer = createCastWriter(castPath, { width: cols, height: rows });
  writer.writeHeader();

  const hookPath = await writeHookFile(shell);

  const ptyProcess = pty.default.spawn(shell, ['-l'], {
    cols,
    rows,
    env: { ...process.env, SEKKO_SESSION: '1', TERM: process.env.TERM || 'xterm-256color' },
  });

  // Wire PTY output → terminal + cast file
  ptyProcess.onData((data) => {
    process.stdout.write(data);
    writer.writeOutput(data);
  });

  // Wire stdin → PTY + cast file (input events)
  const onStdinData = (data) => {
    ptyProcess.write(data.toString());
    writer.writeInput(data.toString());
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onStdinData);

  // Handle terminal resize
  const onResize = () => {
    const newCols = process.stdout.columns;
    const newRows = process.stdout.rows;
    ptyProcess.resize(newCols, newRows);
    writer.writeResize(newCols, newRows);
  };
  process.stdout.on('resize', onResize);

  // Inject hooks by sourcing the temp file
  ptyProcess.write(`source ${hookPath}\r`);

  const startTime = Date.now();

  return new Promise((resolvePromise) => {
    ptyProcess.onExit(async ({ exitCode }) => {
      // Restore terminal
      process.stdin.removeListener('data', onStdinData);
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      await writer.close();

      // Clean up temp hook file
      try { await unlink(hookPath); } catch { /* ok */ }

      const durationMs = Date.now() - startTime;
      resolvePromise({ castPath, durationMs, exitCode });
    });
  });
}
