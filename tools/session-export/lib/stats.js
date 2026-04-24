import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { transformUserText } from './parse.js';

/**
 * Normalize a JSONL record into a countable turn, or null to skip.
 *
 * Returns one of:
 *   null                                                 — skip
 *   { role, timestamp, usage, model }                    — countable
 *
 * Roles:
 *   'user'      — top-level user with at least one non-empty text block
 *                 surviving transformUserText (drops <local-command-*>,
 *                 tool-result-only records; keeps slash commands)
 *   'assistant' — top-level assistant
 *   'subagent'  — file-based subagent assistant OR inline agent_progress
 *                 with inner role === 'assistant'
 *
 * `usage` / `model` are null for user turns and for assistants lacking a
 * `usage` object. The caller still counts the turn; it just contributes zero
 * tokens.
 */
export function normalizeRecord(record, { inSubagentFile = false } = {}) {
  const timestamp = record.timestamp ?? null;

  if (inSubagentFile) {
    if (record.type === 'assistant') {
      return {
        role: 'subagent',
        timestamp,
        usage: record.message?.usage ?? null,
        model: record.message?.model ?? null,
      };
    }
    return null;
  }

  if (record.type === 'assistant') {
    return {
      role: 'assistant',
      timestamp,
      usage: record.message?.usage ?? null,
      model: record.message?.model ?? null,
    };
  }

  if (record.type === 'user') {
    if (!hasCountableUserText(record)) return null;
    return { role: 'user', timestamp, usage: null, model: null };
  }

  if (record.type === 'progress' && record.data?.type === 'agent_progress') {
    const inner = record.data.message?.message;
    if (inner?.role !== 'assistant') return null;
    return {
      role: 'subagent',
      timestamp,
      usage: inner.usage ?? null,
      model: inner.model ?? null,
    };
  }

  return null;
}

function hasCountableUserText(record) {
  const content = record.message?.content;

  if (typeof content === 'string') {
    return transformUserText(content) !== null;
  }

  if (!Array.isArray(content)) return false;

  for (const block of content) {
    if (typeof block === 'string') {
      if (transformUserText(block) !== null) return true;
      continue;
    }
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (transformUserText(block.text) !== null) return true;
    }
  }
  return false;
}

/**
 * Pure aggregation. Reads a session's records and its subagent records,
 * returns stats within the window, or null if zero in-window activity.
 *
 * Records with no timestamp are skipped. `after` / `before` are Date objects;
 * comparison is inclusive on both ends.
 */
export function aggregateSession(records, subagentRecords, { after, before }) {
  const turns = { user: 0, assistant: 0, subagent: 0 };
  const tokensByModel = {};
  let firstMs = null;
  let lastMs = null;

  const afterMs = after.getTime();
  const beforeMs = before.getTime();

  const countOne = (norm) => {
    if (!norm || !norm.timestamp) return;
    const t = new Date(norm.timestamp).getTime();
    if (Number.isNaN(t) || t < afterMs || t > beforeMs) return;

    turns[norm.role]++;
    if (firstMs === null || t < firstMs) firstMs = t;
    if (lastMs === null || t > lastMs) lastMs = t;

    if (norm.usage) {
      const key = norm.model ?? 'unknown';
      const bucket = tokensByModel[key] ?? (tokensByModel[key] = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_creation: 0,
      });
      bucket.input          += norm.usage.input_tokens ?? 0;
      bucket.output         += norm.usage.output_tokens ?? 0;
      bucket.cache_read     += norm.usage.cache_read_input_tokens ?? 0;
      bucket.cache_creation += norm.usage.cache_creation_input_tokens ?? 0;
    }
  };

  for (const r of records) countOne(normalizeRecord(r));
  for (const r of subagentRecords) countOne(normalizeRecord(r, { inSubagentFile: true }));

  if (turns.user + turns.assistant + turns.subagent === 0) return null;

  return {
    turns,
    tokens_by_model: tokensByModel,
    started_at: new Date(firstMs).toISOString(),
    ended_at: new Date(lastMs).toISOString(),
    duration_ms: lastMs - firstMs,
  };
}

/** Read a .jsonl file and parse each non-blank line. Returns an array of records. */
export async function readJsonlRecords(path, deps = {}) {
  const { readFile: read = readFile } = deps;
  const raw = await read(path, 'utf-8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

/** Read all subagent JSONL records for a parent session. Returns [] if no subagents dir. */
export async function readSubagentRecords(parentJsonlPath, deps = {}) {
  const { readFile: read = readFile, readdir: readDir = readdir } = deps;
  const sessionDir = parentJsonlPath.replace(/\.jsonl$/, '');
  const subagentsDir = join(sessionDir, 'subagents');

  let entries;
  try {
    entries = await readDir(subagentsDir);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }

  const all = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const records = await readJsonlRecords(join(subagentsDir, name), { readFile: read });
    all.push(...records);
  }
  return all;
}

/** Extract the session ID from a JSONL path (filename minus `.jsonl`). */
export function sessionIdFromPath(jsonlPath) {
  return basename(jsonlPath, '.jsonl');
}
