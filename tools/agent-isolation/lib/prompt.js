// prompt.js — Synchronous one-line TTY prompt (the bash `read -r -p`).
//
// launch runs synchronously and the post-session teardown question must
// block for a real answer. Reads a line from the controlling terminal.
// If no TTY is available (non-interactive context) it returns '' — which
// the caller treats as the default (teardown), matching bash `read || true`.

import { openSync, readSync, closeSync } from 'node:fs';

export function promptLine(question) {
  process.stdout.write(question);
  let fd;
  try {
    fd = openSync('/dev/tty', 'rs');
  } catch {
    return '';
  }
  let input = '';
  const buf = Buffer.alloc(1);
  try {
    for (;;) {
      const bytes = readSync(fd, buf, 0, 1, null);
      if (bytes === 0) break;
      const ch = buf.toString('utf8');
      if (ch === '\n') break;
      input += ch;
    }
  } finally {
    closeSync(fd);
  }
  return input.replace(/\r$/, '');
}
