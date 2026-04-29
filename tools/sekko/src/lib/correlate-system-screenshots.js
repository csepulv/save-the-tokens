import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { derivePageLabel } from './page-labels.js';

const FILENAME_PATTERN = /^screen-(\d+)\.(?:jpg|jpeg)$/;

// List + parse system screencap files (named screen-<epochMs>.jpg) from
// the recording's system-screenshots dir. Returns sorted by wallTime.
export function listSystemScreenshots(sourceDir, deps = {}) {
  const { exists = existsSync, readdir = readdirSync } = deps;
  if (!exists(sourceDir)) return [];

  const entries = readdir(sourceDir);
  const timed = [];
  for (const filename of entries) {
    const match = filename.match(FILENAME_PATTERN);
    if (!match) continue;
    timed.push({
      filename,
      wallTime: parseInt(match[1], 10),
      sourcePath: join(sourceDir, filename),
    });
  }
  timed.sort((a, b) => a.wallTime - b.wallTime);
  return timed;
}

// Pick a system screencap for each action. Prefers the closest frame
// AFTER the action (so we see the result of the action — e.g., the
// popup that just opened, rather than the page state moments before).
// Falls back to closest-before only if no after-frame is in the window.
//
// 1Hz capture cadence + ±1500ms window means an action gets the next
// frame within ~1s. Each frame is used at most once.
export function correlateSystemScreenshots(actions, screenshots, windowMs = 1500) {
  if (!screenshots.length || !actions.length) return [];

  const selected = [];
  const used = new Set();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.timestamp == null) continue;

    let bestAfterIdx = null;
    let bestAfterDelta = Infinity;
    let bestAbsIdx = null;
    let bestAbsDelta = Infinity;

    for (let j = 0; j < screenshots.length; j++) {
      if (used.has(j)) continue;
      const delta = screenshots[j].wallTime - action.timestamp;
      const absDelta = Math.abs(delta);
      if (absDelta > windowMs) continue;

      if (delta >= 0 && delta < bestAfterDelta) {
        bestAfterDelta = delta;
        bestAfterIdx = j;
      }
      if (absDelta < bestAbsDelta) {
        bestAbsDelta = absDelta;
        bestAbsIdx = j;
      }
    }

    const bestIdx = bestAfterIdx !== null ? bestAfterIdx : bestAbsIdx;
    if (bestIdx !== null) {
      used.add(bestIdx);
      selected.push({
        ...screenshots[bestIdx],
        actionIndex: i + 1,
        label: derivePageLabel(action.url),
      });
    }
  }

  return selected;
}
