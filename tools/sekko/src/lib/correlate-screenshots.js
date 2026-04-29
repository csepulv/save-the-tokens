import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { derivePageLabel } from './page-labels.js';

// Extract wall-clock timestamp from screenshot sha1 filename.
// Format: page@<pageId>-<epoch>.jpeg
function getWallTime(screenshot) {
  const match = screenshot.sha1?.match(/-(\d+)\.jpeg$/);
  return match ? parseInt(match[1], 10) : null;
}

// For each action, find the closest screenshot taken AFTER the action.
// Prefers a screenshot from the same page (matching pageId) when one
// is available within the time window; otherwise falls back to any
// page's screenshot to preserve existing behavior.
//
// Returns a reduced set of screenshots, each tagged with the action it
// represents and a derived surface label (popup/sidepanel/options/ext)
// when the action ran on an extension page.
export function correlateScreenshots(actions, screenshots, windowMs = 3000) {
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

    const sameOnly = action.pageId
      ? findClosestAfter(timed, action.timestamp, windowMs, usedIndices, action.pageId)
      : null;
    // Unresolvable extension actions: action ran on a chrome-extension://
    // URL but no Playwright pageId resolved (typical for MV3 popups
    // caught by the CDP target listener — Playwright never tracked
    // those as pages, so no frames exist from them). Skip page-area
    // correlation to avoid grabbing a misleading frame from a different
    // page; the system screenshot correlator handles these via
    // timestamp-only matching against full-screen captures.
    const isUnresolvedExtensionAction = action.url
      && action.url.startsWith('chrome-extension://')
      && !action.pageId;

    const matched = sameOnly !== null
      ? sameOnly
      : isUnresolvedExtensionAction
        ? null
        : findClosestAfter(timed, action.timestamp, windowMs, usedIndices, null);

    if (matched !== null) {
      usedIndices.add(matched);
      selected.push({
        ...timed[matched],
        actionIndex: actionIdx + 1,
        label: derivePageLabel(action.url),
      });
    }
  }

  return selected;
}

function findClosestAfter(sortedScreenshots, actionTime, windowMs, usedIndices, requirePageId) {
  let bestIdx = null;
  let bestDelta = Infinity;

  for (let i = 0; i < sortedScreenshots.length; i++) {
    if (usedIndices.has(i)) continue;
    const delta = sortedScreenshots[i].wallTime - actionTime;
    if (delta > windowMs) break;
    if (delta < 0) continue;
    if (requirePageId && sortedScreenshots[i].pageId !== requirePageId) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Copy correlated screenshots to output dir, named by action.
// Filename includes a surface label when the action ran on an
// extension page: action-08-popup.jpeg, action-09-sidepanel.jpeg.
// Main-page actions retain the existing format: action-07.jpeg.
export function saveCorrelatedScreenshots(correlatedShots, outputDir, deps = {}) {
  const { mkdirSync: mkdirFn = mkdirSync, copyFileSync: copyFn = copyFileSync } = deps;
  mkdirFn(outputDir, { recursive: true });

  const saved = [];
  for (const shot of correlatedShots) {
    const indexPart = String(shot.actionIndex).padStart(2, '0');
    const labelPart = shot.label ? `-${shot.label}` : '';
    const filename = `action-${indexPart}${labelPart}.jpeg`;
    const destPath = resolve(outputDir, filename);
    copyFn(shot.savedPath, destPath);
    saved.push({ ...shot, savedPath: destPath, filename });
  }

  return saved;
}
