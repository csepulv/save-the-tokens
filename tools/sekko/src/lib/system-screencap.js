import { spawn as nodeSpawn } from 'child_process';
import { resolve } from 'path';

const SCREENCAP_BIN = '/usr/sbin/screencapture';

// Build screencapture argv. When `region` is given we capture just that
// rectangle (browser window only); otherwise the full display. region is
// `{x, y, w, h}` in display points (top-left origin), matching the
// `screencapture -R` coordinate system.
function buildArgs(path, region) {
  const args = ['-t', 'jpg', '-x'];
  if (region && Number.isFinite(region.w) && Number.isFinite(region.h) && region.w > 0 && region.h > 0) {
    args.push('-R', `${region.x},${region.y},${region.w},${region.h}`);
  }
  args.push(path);
  return args;
}

// Window-bounded snapshot of the browser. Used by trace.js to derive
// `region` from the recorded page via window.screenX/Y + outerWidth/Height.
export async function getBrowserWindowRegion(page) {
  try {
    const bounds = await page.evaluate(() => {
      const chromeHeight = Math.max(0, window.outerHeight - window.innerHeight);
      return {
        x: Math.round(window.screenX),
        y: Math.round(window.screenY - chromeHeight),
        w: Math.round(window.outerWidth),
        h: Math.round(window.outerHeight),
      };
    });
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
    return bounds;
  } catch {
    return null;
  }
}

// Periodically captures a JPEG via macOS `screencapture`. Captures the
// browser window when `region` is provided; otherwise full display. Used
// to record state that Playwright's page-area screenshots miss — most
// importantly extension popups, which Chromium renders as a UI overlay
// attached to the toolbar that doesn't surface as a Playwright page.
//
// outputDir must exist; one file is written per interval as
// screen-<epochMs>.jpg. Returns a controller with stop() / getCount().
export function startSystemScreencap({ outputDir, intervalMs = 1000, region = null, deps = {} } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const { spawn = nodeSpawn, now = Date.now } = deps;

  let active = true;
  let count = 0;
  let currentRegion = region;

  const captureOnce = () => {
    if (!active) return;
    const path = resolve(outputDir, `screen-${now()}.jpg`);
    const child = spawn(SCREENCAP_BIN, buildArgs(path, currentRegion), { stdio: 'ignore' });
    child.on('error', () => {});
    child.on('exit', (code) => {
      if (code === 0) count++;
    });
  };

  captureOnce();
  const timer = setInterval(captureOnce, intervalMs);

  return {
    stop() {
      active = false;
      clearInterval(timer);
    },
    getCount() {
      return count;
    },
    // Update the capture region (e.g., when the user has resized/moved
    // the browser window). Cheap; takes effect on the next capture.
    updateRegion(newRegion) {
      currentRegion = newRegion;
    },
  };
}
