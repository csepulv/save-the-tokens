import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Extract wall-clock timestamp from screenshot sha1 filename.
 * Format: page@<pageId>-<epoch>.jpeg
 */
function getWallTime(screenshot) {
  const match = screenshot.sha1?.match(/-(\d+)\.jpeg$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * For each action, find the closest screenshot taken AFTER the action.
 * Returns a reduced set of screenshots, each tagged with the action it represents.
 */
export function correlateScreenshots(actions, screenshots) {
  // Add wall-clock timestamps to screenshots
  const timed = screenshots
    .map((s) => ({ ...s, wallTime: getWallTime(s) }))
    .filter((s) => s.wallTime !== null)
    .sort((a, b) => a.wallTime - b.wallTime);

  if (timed.length === 0) return [];

  const selected = [];
  const usedIndices = new Set();

  for (let actionIdx = 0; actionIdx < actions.length; actionIdx++) {
    const action = actions[actionIdx];
    if (!action.timestamp) continue;

    // Find the first screenshot after this action (within 3s)
    const bestIdx = findClosestAfter(timed, action.timestamp, 3000);
    if (bestIdx !== null && !usedIndices.has(bestIdx)) {
      usedIndices.add(bestIdx);
      selected.push({
        ...timed[bestIdx],
        actionIndex: actionIdx + 1,
      });
    }
  }

  return selected;
}

function findClosestAfter(sortedScreenshots, actionTime, maxWindowMs) {
  let bestIdx = null;
  let bestDelta = Infinity;

  for (let i = 0; i < sortedScreenshots.length; i++) {
    const delta = sortedScreenshots[i].wallTime - actionTime;
    if (delta >= 0 && delta <= maxWindowMs && delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
    // Sorted, so once delta exceeds window, stop
    if (delta > maxWindowMs) break;
  }

  return bestIdx;
}

/**
 * Copy correlated screenshots to output dir, named by action.
 */
export function saveCorrelatedScreenshots(correlatedShots, outputDir) {
  mkdirSync(outputDir, { recursive: true });

  const saved = [];
  for (const shot of correlatedShots) {
    const filename = `action-${String(shot.actionIndex).padStart(2, '0')}.jpeg`;
    const destPath = resolve(outputDir, filename);
    copyFileSync(shot.savedPath, destPath);
    saved.push({ ...shot, savedPath: destPath, filename });
  }

  return saved;
}
