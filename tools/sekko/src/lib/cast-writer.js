import { createWriteStream } from 'fs';

export function createCastWriter(outputPath, { width, height }) {
  const stream = createWriteStream(outputPath);
  const startTime = Date.now();

  const elapsed = () => (Date.now() - startTime) / 1000;

  const writeLine = (obj) => {
    stream.write(JSON.stringify(obj) + '\n');
  };

  return {
    writeHeader() {
      writeLine({
        version: 2,
        width,
        height,
        timestamp: Math.floor(startTime / 1000),
        env: { SHELL: process.env.SHELL || '/bin/zsh', TERM: process.env.TERM || 'xterm-256color' },
      });
    },

    writeOutput(data) {
      writeLine([elapsed(), 'o', data]);
    },

    writeInput(data) {
      writeLine([elapsed(), 'i', data]);
    },

    writeResize(cols, rows) {
      writeLine([elapsed(), 'r', `${cols}x${rows}`]);
    },

    close() {
      return new Promise((resolve) => stream.end(resolve));
    },
  };
}
