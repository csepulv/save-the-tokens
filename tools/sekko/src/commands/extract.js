import { mkdir, writeFile, readdir, copyFile } from 'fs/promises';
import { existsSync, readFileSync, rmSync } from 'fs';
import { dirname, resolve, join } from 'path';
import {
  extractScreenshots,
  getNetworkTraffic,
  prepareTraceDir,
} from '@andrii_kremlovskyi/playwright-traces-reader';
import { extractSelectors, parseActions } from '../lib/parse-actions.js';
import { parseUserEvents } from '../lib/parse-user-events.js';
import { loadConfig } from '../lib/config.js';
import { filterNetwork } from '../lib/filter-network.js';
import { correlateActionAndNetworkCalls } from '../lib/correlate.js';
import { correlateScreenshots, saveCorrelatedScreenshots } from '../lib/correlate-screenshots.js';
import { buildPageHistoryFromTraceDir, resolvePageId } from '../lib/build-page-map.js';
import { listSystemScreenshots, correlateSystemScreenshots } from '../lib/correlate-system-screenshots.js';
import { buildNetworkDetail } from '../lib/formatters/network-detail.js';
import { formatActions } from '../lib/formatters/actions.js';
import { formatNetwork } from '../lib/formatters/network.js';
import { formatSelectors } from '../lib/formatters/selectors.js';
import { formatSummary } from '../lib/formatters/summary.js';
import { formatNarration } from '../lib/formatters/narration.js';
import { parseTerminalRecording, extractCommands, detectInteractiveSession, summarizeInteractiveSession, truncateOutput } from '../lib/parse-terminal-session.js';
import { redactCredentials } from '../lib/redact-credentials.js';
import { formatTerminalSessionMarkdown, formatTerminalSessionJson } from '../lib/formatters/terminal-session.js';
import { formatTerminalSummary } from '../lib/formatters/terminal-summary.js';

export async function extract(tracePath, options) {
  const resolvedTrace = resolve(tracePath);

  if (resolvedTrace.endsWith('.cast')) {
    return extractTerminal(resolvedTrace, options);
  }
  if (!resolvedTrace.endsWith('.zip')) {
    console.error(`Error: Unrecognized file type. Expected .zip (web trace) or .cast (terminal recording).`);
    process.exit(1);
  }

  const { outputDir, screenshotDir, tempScreenshotDir, config } = await loadConfigAndPrepareDirs(options);
  console.log(`Extracting trace from ${resolvedTrace}...`);

  const ctx = await prepareTraceDir(resolvedTrace);
  let { actions, selectors } = parseActionsFromTrace(resolvedTrace, ctx);
  let detailEntries = await extractNetworkDetails(ctx, config);

  const correlated = correlateActionAndNetworkCalls(actions, detailEntries);
  actions = correlated.actions;
  detailEntries = correlated.network;

  const { source, savedShots, allCount } = await pickAndCorrelateScreenshots({
    tracePath: resolvedTrace,
    ctx,
    tempScreenshotDir,
    actions,
    screenshotDir,
  });

  const narration = loadNarration(resolvedTrace);
  if (narration) {
    console.log(`  Narration: ${narration.words.length} words`);
  } else {
    checkForUntranscribedAudio(resolvedTrace);
  }

  await writeArtifacts(outputDir, { actions, detailEntries, selectors, savedShots, screenshotSource: source, narration });
  printSummary(outputDir, { actions, detailEntries, selectors, savedShots, allCount, screenshotSource: source, narration });
}

// --- Helpers (the "how") ---

// --- Terminal extraction ---

async function extractTerminal(castPath, options) {
  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  console.log(`Extracting terminal recording from ${castPath}...`);

  const { header, events } = await parseTerminalRecording(castPath);
  let commands = extractCommands(events);
  console.log(`  ${commands.length} commands found`);

  // Post-process each command
  commands = commands.map((cmd) => {
    if (detectInteractiveSession(cmd.output)) {
      return { ...cmd, output: summarizeInteractiveSession(cmd.command, cmd.durationMs) };
    }
    let output = redactCredentials(cmd.output);
    output = truncateOutput(output);
    return { ...cmd, output };
  });

  const session = {
    sessionStart: commands[0]?.startMs || header.timestamp * 1000,
    sessionEnd: commands[commands.length - 1]?.endMs || header.timestamp * 1000,
    shell: header.env?.SHELL || 'unknown',
    commands,
  };

  // Check for narration
  const narration = loadNarration(castPath);
  if (narration) {
    console.log(`  Narration: ${narration.words.length} words`);
  } else {
    checkForUntranscribedAudio(castPath);
  }

  // Write artifacts
  const artifacts = [
    { file: 'terminal-session.md', content: formatTerminalSessionMarkdown(session) },
    { file: 'terminal-session.json', content: JSON.stringify(formatTerminalSessionJson(session), null, 2) },
    ...(narration ? [{ file: 'narration.md', content: formatNarration(narration) }] : []),
    { file: 'summary.md', content: formatTerminalSummary({
      commandCount: commands.length,
      narrationWordCount: narration?.words?.length || 0,
    }) },
  ];

  for (const { file, content } of artifacts) {
    await writeFile(resolve(outputDir, file), content);
  }

  console.log(`\nExtraction complete. Output in ${outputDir}/`);
  console.log(`  terminal-session.md  — ${commands.length} commands`);
  console.log(`  terminal-session.json — structured data`);
  if (narration) {
    console.log(`  narration.md         — ${narration.words.length} words`);
  }
  console.log(`  summary.md           — artifact manifest`);
}

// --- Web extraction helpers ---

async function loadConfigAndPrepareDirs(options) {
  const outputDir = resolve(options.output);
  const screenshotDir = resolve(outputDir, 'screenshots');
  const tempScreenshotDir = resolve(outputDir, '.screenshots-raw');
  await mkdir(screenshotDir, { recursive: true });
  await mkdir(tempScreenshotDir, { recursive: true });

  const config = loadConfig(options);
  if (config._loaded) {
    console.log(`  Config loaded from ${config._path}`);
  }
  return { outputDir, screenshotDir, tempScreenshotDir, config };
}

function parseActionsFromTrace(resolvedTrace, ctx) {
  const eventsPath = resolve(dirname(resolvedTrace), 'user-events.json');

  if (existsSync(eventsPath)) {
    const actions = parseUserEvents(eventsPath);
    const selectors = extractSelectors(actions);
    console.log(`  Using user-events.json (${actions.length} collapsed events)`);
    return { actions, selectors };
  }

  const actions = parseActions(ctx.traceDir);
  const selectors = extractSelectors(actions);
  console.log(`  Using trace.trace action log (${actions.length} actions)`);
  return { actions, selectors };
}

async function extractNetworkDetails(ctx, config) {
  let network = await getNetworkTraffic(ctx);
  const unfilteredCount = network.length;
  network = filterNetwork(network, config);
  if (network.length < unfilteredCount) {
    console.log(`  Filtered network: ${network.length} of ${unfilteredCount} requests`);
  }
  return buildNetworkDetail(network);
}

// Pick the screenshot source for this extract: system frames if the
// recording captured them (--system-screenshots was set), otherwise
// Playwright page-area frames from trace.zip. Output is the same shape
// (screenshots/action-NN.jpeg) either way; the consuming agent learns
// which source via summary.md.
async function pickAndCorrelateScreenshots({ tracePath, ctx, tempScreenshotDir, actions, screenshotDir }) {
  const sysSourceDir = resolve(dirname(tracePath), 'system-screenshots');
  const sysShots = listSystemScreenshots(sysSourceDir);

  if (sysShots.length > 0) {
    return correlateAndSaveSystemSource({ sysShots, actions, screenshotDir });
  }
  return correlateAndSavePlaywrightSource({ ctx, tempScreenshotDir, actions, screenshotDir });
}

async function correlateAndSavePlaywrightSource({ ctx, tempScreenshotDir, actions, screenshotDir }) {
  const allScreenshots = await extractScreenshots(ctx, tempScreenshotDir);
  const taggedActions = tagActionsWithPageId(actions, ctx.traceDir);
  const correlatedShots = correlateScreenshots(taggedActions, allScreenshots);
  const savedShots = saveCorrelatedScreenshots(correlatedShots, screenshotDir);
  rmSync(tempScreenshotDir, { recursive: true, force: true });
  console.log(`  Screenshots: ${allScreenshots.length} Playwright frames → ${savedShots.length} correlated to actions`);
  return { source: 'playwright', allCount: allScreenshots.length, savedShots };
}

async function correlateAndSaveSystemSource({ sysShots, actions, screenshotDir }) {
  const correlated = correlateSystemScreenshots(actions, sysShots);
  await mkdir(screenshotDir, { recursive: true });
  const savedShots = [];
  for (const shot of correlated) {
    const indexPart = String(shot.actionIndex).padStart(2, '0');
    const labelPart = shot.label ? `-${shot.label}` : '';
    const filename = `action-${indexPart}${labelPart}.jpeg`;
    const destPath = join(screenshotDir, filename);
    await copyFile(shot.sourcePath, destPath);
    savedShots.push({ ...shot, savedPath: destPath, filename });
  }
  console.log(`  Screenshots: ${sysShots.length} system frames → ${savedShots.length} correlated to actions`);
  return { source: 'system', allCount: sysShots.length, savedShots };
}

function tagActionsWithPageId(actions, traceDir) {
  const history = buildPageHistoryFromTraceDir(traceDir);
  if (history.length === 0) return actions;
  return actions.map((action) => {
    if (!action.url || action.timestamp == null) return action;
    const pageId = resolvePageId(history, action.url, action.timestamp);
    return pageId ? { ...action, pageId } : action;
  });
}

function checkForUntranscribedAudio(tracePath) {
  const audioPath = resolve(dirname(tracePath), 'voice-over.wav');
  if (existsSync(audioPath)) {
    console.log(`  Note: voice-over.wav found but no narration.json. Run 'node bin/sekko.js transcribe ${audioPath}' to transcribe.`);
  }
}

function loadNarration(tracePath) {
  const narrationPath = resolve(dirname(tracePath), 'narration.json');
  if (!existsSync(narrationPath)) return null;
  try {
    const content = readFileSync(narrationPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeArtifacts(outputDir, { actions, detailEntries, selectors, savedShots, screenshotSource, narration }) {
  const artifacts = [
    { file: 'actions.md', content: formatActions(actions) },
    { file: 'network.md', content: formatNetwork(detailEntries) },
    { file: 'network-detail.json', content: JSON.stringify(detailEntries, null, 2) },
    { file: 'selectors.md', content: formatSelectors(selectors) },
    ...(narration ? [{ file: 'narration.md', content: formatNarration(narration) }] : []),
    {
      file: 'summary.md',
      content: formatSummary({
        actionCount: actions.length,
        selectorCount: selectors.length,
        networkCount: detailEntries.length,
        screenshotCount: savedShots.length,
        screenshotSource,
        narrationWordCount: narration?.words?.length || 0,
        outputDir,
      }),
    },
  ];

  for (const { file, content } of artifacts) {
    await writeFile(resolve(outputDir, file), content);
  }
}

function printSummary(outputDir, { actions, detailEntries, selectors, savedShots, allCount, screenshotSource, narration }) {
  console.log(`\nExtraction complete. Output in ${outputDir}/`);
  console.log(`  actions.md          — ${actions.length} actions`);
  console.log(`  network.md          — ${detailEntries.length} requests`);
  console.log(`  network-detail.json — full request/response data`);
  console.log(`  selectors.md        — ${selectors.length} selectors`);
  const sourceLabel = screenshotSource === 'system' ? 'system frames' : 'Playwright frames';
  console.log(`  screenshots/        — ${savedShots.length} of ${allCount} ${sourceLabel} (correlated to actions)`);
  if (narration) {
    console.log(`  narration.md        — ${narration.words.length} words`);
  }
  console.log(`  summary.md          — artifact manifest`);
}
