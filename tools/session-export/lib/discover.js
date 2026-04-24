import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveProjectName } from './project-name.js';

const DEFAULT_SOURCE_DIR = join(homedir(), '.claude');

function projectsDir(sourceDir) {
  return join(sourceDir || DEFAULT_SOURCE_DIR, 'projects');
}

export async function listJsonlFiles(dir, deps = {}) {
  const { readdir: readDir = readdir, stat: statFn = stat } = deps;

  const results = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readDir(current, { withFileTypes: true });
    } catch (err) {
      // ENOENT: directory absent (top-level dir not created, or a subdir
      // raced away during walk). EACCES/EPERM: unreadable subdir — skip
      // and keep walking. Other errors bubble (disk full, I/O, etc.).
      if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') return;
      throw err;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip subagents directories
        if (entry.name === 'subagents') continue;
        await walk(fullPath);
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

async function readCustomTitle(jsonlPath, deps = {}) {
  const { readFile: read = readFile } = deps;
  try {
    const raw = await read(jsonlPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line);
      if (d.type === 'custom-title') return d.customTitle ?? '';
    }
  } catch {
    // File unreadable or malformed
  }
  return '';
}

async function readFirstUserMessage(jsonlPath, maxLen = 100, deps = {}) {
  const { readFile: read = readFile } = deps;
  try {
    const raw = await read(jsonlPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line);
      if (d.type !== 'user') continue;
      const content = d.message?.content ?? '';
      const text = extractFirstText(content);
      if (text) {
        // Skip infrastructure messages (local commands, caveats)
        if (text.startsWith('<local-command-') || text.startsWith('<command-name>/')) continue;
        const cleaned = stripXmlTags(text.replace(/\n/g, ' '));
        if (!cleaned) continue;
        return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
      }
    }
  } catch {
    // File unreadable or malformed
  }
  return '';
}

function extractFirstText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') return block;
      if (typeof block === 'object' && block?.type === 'text') return block.text ?? '';
    }
  }
  return '';
}

function stripXmlTags(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

export function extractEncodedProjectDir(jsonlPath) {
  const parts = jsonlPath.split('/');
  const projectIdx = parts.indexOf('projects');
  if (projectIdx === -1 || projectIdx + 1 >= parts.length) return '';
  return parts[projectIdx + 1];
}

export async function findJsonl(conversationId, sourceDir = null, deps = {}) {
  const base = projectsDir(sourceDir);
  const files = await listJsonlFiles(base, deps);

  // First pass: match by session ID in filename
  for (const f of files) {
    const name = f.split('/').pop();
    if (name.includes(conversationId)) return f;
  }

  // Second pass: match by custom title
  for (const f of files) {
    const title = await readCustomTitle(f, deps);
    if (title && title.includes(conversationId)) return f;
  }

  return null;
}

export async function listConversations(sourceDir = null, deps = {}) {
  const { stat: statFn = stat } = deps;
  const base = projectsDir(sourceDir);
  const files = await listJsonlFiles(base, deps);

  const entries = [];

  for (const f of files) {
    const name = f.split('/').pop().replace('.jsonl', '');
    // Skip non-conversation files
    if (name.length < 8 || name === 'sessions') continue;

    let modTime;
    try {
      const s = await statFn(f);
      modTime = s.mtime;
    } catch {
      continue;
    }

    const encodedDir = extractEncodedProjectDir(f);
    const project = encodedDir ? await resolveProjectName(encodedDir, deps) : '';
    const title = await readCustomTitle(f, deps);
    const preview = title || await readFirstUserMessage(f, 100, deps);

    entries.push({
      sessionId: name,
      date: modTime,
      project,
      encodedDir,
      preview,
      path: f,
    });
  }

  // Sort newest first
  entries.sort((a, b) => b.date - a.date);
  return entries;
}
