import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { hostname as osHostname } from 'node:os';
import { resolveProjectName } from './project-name.js';

const SKIPPED_TYPES = new Set([
  'file-history-snapshot', 'queue-operation', 'last-prompt',
  'agent-name', 'agent-color', 'attachment',
]);

const DROP_PATTERNS = [
  /^<local-command-caveat>/,
  /^<local-command-stdout>/,
];

const COMMAND_NAME_RE = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
export const SKILL_BODY_PREFIX = 'Base directory for this skill:';

export function transformUserText(text) {
  const trimmed = text.trim();

  if (DROP_PATTERNS.some((pattern) => pattern.test(trimmed))) return null;

  if (trimmed.includes('<command-name>') && trimmed.includes('<command-args>')) {
    const name = trimmed.match(COMMAND_NAME_RE)?.[1]?.trim() ?? '';
    if (name.startsWith('/')) {
      const args = (trimmed.match(COMMAND_ARGS_RE)?.[1] ?? '').trim();
      return args ? `${name} ${args}` : name;
    }
  }

  return text;
}

export function truncateSkillBody(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SKILL_BODY_PREFIX)) return text;
  const lines = trimmed.split('\n').filter((line) => line.trim());
  return lines.slice(0, 2).join('\n');
}

function summarizeToolCall(name, input) {
  if (name === 'Read') return `[Read: ${input.file_path ?? '?'}]`;
  if (name === 'Grep') return `[Grep: "${input.pattern ?? '?'}" in ${input.path ?? '.'}]`;
  if (name === 'Glob') return `[Glob: ${input.pattern ?? '?'} in ${input.path ?? '.'}]`;
  if (name === 'Write') return `[Write: ${input.file_path ?? '?'} (${(input.content ?? '').length} chars)]`;
  if (name === 'Edit') return `[Edit: ${input.file_path ?? '?'}]`;
  if (name === 'Bash') return `[Bash: ${(input.command ?? '?').slice(0, 150)}]`;
  if (name === 'Agent') return `[Agent: ${input.description ?? input.prompt?.slice(0, 80) ?? '?'}]`;
  if (name === 'WebSearch') return `[WebSearch: ${input.query ?? '?'}]`;
  if (name === 'WebFetch') return `[WebFetch: ${input.url ?? '?'}]`;
  const inputStr = JSON.stringify(input);
  if (inputStr === '{}') return `[${name}]`;
  return `[${name}: ${inputStr.slice(0, 200)}]`;
}

function extractContent(content, externalToolNameMap = {}, auqTracker = null) {
  const text = [];
  const toolCalls = [];
  const toolResults = [];
  const thinking = [];
  const toolNameMap = {};
  const questions = [];
  const auqResultIds = [];

  if (typeof content === 'string') {
    if (content.trim()) text.push(content);
    return { text, toolCalls, toolResults, thinking, toolNameMap, questions, auqResultIds };
  }

  if (!Array.isArray(content)) {
    return { text, toolCalls, toolResults, thinking, toolNameMap, questions, auqResultIds };
  }

  for (const block of content) {
    if (typeof block === 'string') {
      if (block.trim()) text.push(block);
      continue;
    }
    if (typeof block !== 'object' || block === null) continue;

    const btype = block.type ?? '';

    if (btype === 'text') {
      const t = block.text ?? '';
      if (t.trim()) text.push(t);
    } else if (btype === 'tool_use') {
      const name = block.name ?? '?';
      const input = block.input ?? {};
      if (name === 'AskUserQuestion') {
        const inputQuestions = Array.isArray(input.questions) ? input.questions : [];
        questions.push(...inputQuestions);
        if (block.id && auqTracker) auqTracker.add(block.id);
        continue;
      }
      toolCalls.push(summarizeToolCall(name, input));
      if (block.id) toolNameMap[block.id] = name;
    } else if (btype === 'thinking') {
      const t = block.thinking ?? '';
      if (t.trim()) thinking.push(t);
    } else if (btype === 'tool_result') {
      const toolId = block.tool_use_id ?? '';
      if (toolId && auqTracker?.has(toolId)) {
        auqResultIds.push(toolId);
        continue;
      }
      let resultContent = block.content ?? '';
      if (Array.isArray(resultContent)) {
        resultContent = resultContent
          .filter((b) => typeof b === 'object' && b?.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ');
      }
      if (resultContent && typeof resultContent === 'string') {
        const toolName = toolNameMap[toolId] ?? externalToolNameMap[toolId] ?? 'Tool';
        toolResults.push({ toolName, content: resultContent });
      }
    }
  }

  return { text, toolCalls, toolResults, thinking, toolNameMap, questions, auqResultIds };
}

function buildAnswers(toolUseResult) {
  if (!toolUseResult || typeof toolUseResult !== 'object') return [];
  const questions = Array.isArray(toolUseResult.questions) ? toolUseResult.questions : [];
  const answers = toolUseResult.answers ?? {};
  const annotations = toolUseResult.annotations ?? {};

  return questions.map((q) => {
    const entry = {
      header: q.header ?? '',
      question: q.question ?? '',
      multiSelect: q.multiSelect ?? false,
      options: Array.isArray(q.options) ? q.options : [],
      selected: answers[q.question] ?? '',
    };
    const notes = annotations[q.question]?.notes;
    if (notes) entry.notes = notes;
    return entry;
  });
}


async function loadSubagentFiles(jsonlPath, deps = {}) {
  const { readFile: read = readFile, readdir: readDir = readdir } = deps;
  const sessionDir = jsonlPath.replace(/\.jsonl$/, '');
  const subagentsDir = join(sessionDir, 'subagents');

  const agents = [];
  let entries;
  try {
    entries = await readDir(subagentsDir);
  } catch {
    return agents; // No subagents directory
  }

  const jsonlFiles = entries.filter((n) => n.endsWith('.jsonl'));

  for (const name of jsonlFiles) {
    const agentId = name.replace('.jsonl', '');
    let description = null;

    // Read meta file for description (used to match Agent tool_use)
    try {
      const metaRaw = await read(join(subagentsDir, `${agentId}.meta.json`), 'utf-8');
      const meta = JSON.parse(metaRaw);
      description = meta.description ?? null;
    } catch {
      // No meta file
    }

    try {
      const raw = await read(join(subagentsDir, name), 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim());
      const messages = [];
      for (const line of lines) {
        const record = JSON.parse(line);
        const type = record.type ?? record.message?.role ?? '';
        if (type !== 'user' && type !== 'assistant') continue;
        const msg = record.message ?? record;
        const content = msg.content ?? '';
        const { text, toolCalls, toolResults, thinking } = extractContent(content);
        messages.push({ role: type, text, toolCalls, toolResults, thinking });
      }
      agents.push({ agentId, description, messages });
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

export async function parseConversation(jsonlPath, deps = {}) {
  const { readFile: read = readFile, hostname: getHostname = osHostname, readdir: readDir = readdir } = deps;

  const raw = await read(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  // Load subagent files (new format: subagents/*.jsonl)
  const subagentFiles = await loadSubagentFiles(jsonlPath, { readFile: read, readdir: readDir });

  const metadata = {
    sessionId: null,
    project: null,
    customTitle: null,
    sourcePath: String(jsonlPath),
    exportDate: new Date().toISOString(),
    hostname: getHostname(),
    cwd: null,
    gitBranch: null,
    claudeVersion: null,
    permissionMode: null,
    startedAt: null,
    endedAt: null,
  };

  const messages = [];
  let firstTimestamp = null;
  let lastTimestamp = null;

  // Track tool name mappings across all messages for tool_result resolution
  const globalToolNameMap = {};
  // Track AskUserQuestion tool_use_ids so matching tool_results promote to
  // structured `answers` instead of generic toolResults.
  const auqTracker = new Set();

  for (const line of lines) {
    const record = JSON.parse(line);
    const type = record.type ?? '';

    // Track timestamps
    const ts = record.timestamp;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
    }

    if (SKIPPED_TYPES.has(type)) continue;

    // Extract metadata from various record types
    if (type === 'custom-title') {
      metadata.customTitle = record.customTitle ?? null;
      continue;
    }

    if (type === 'permission-mode') {
      metadata.permissionMode = record.permissionMode ?? null;
      if (!metadata.sessionId && record.sessionId) {
        metadata.sessionId = record.sessionId;
      }
      continue;
    }

    if (type === 'progress') {
      const data = record.data ?? {};
      if (data.type === 'agent_progress') {
        // Older format: subagent messages inline
        const innerMsg = data.message?.message ?? {};
        const innerContent = innerMsg.content ?? '';
        const { text, toolCalls, toolResults, thinking, toolNameMap } = extractContent(innerContent, globalToolNameMap);
        Object.assign(globalToolNameMap, toolNameMap);

        messages.push({
          role: 'subagent',
          agentPrompt: data.prompt ?? null,
          agentId: data.agentId ?? null,
          text,
          toolCalls,
          toolResults,
          thinking,
          timestamp: ts ?? null,
        });
      }
      continue;
    }

    if (type === 'system') {
      const content = record.content ?? '';
      const subtype = record.subtype ?? '';
      messages.push({
        role: 'system',
        subtype,
        text: content.trim() ? [content] : [],
        toolCalls: [],
        toolResults: [],
        thinking: [],
        timestamp: ts ?? null,
      });
      continue;
    }

    if (type !== 'user' && type !== 'assistant') continue;

    // Extract metadata from first user record
    if (type === 'user') {
      if (!metadata.sessionId && record.sessionId) metadata.sessionId = record.sessionId;
      if (!metadata.cwd && record.cwd) metadata.cwd = record.cwd;
      if (!metadata.gitBranch && record.gitBranch) metadata.gitBranch = record.gitBranch;
      if (!metadata.claudeVersion && record.version) metadata.claudeVersion = record.version;
    }

    const msg = record.message ?? record;
    const content = msg.content ?? '';
    const { text, toolCalls, toolResults, thinking, toolNameMap, questions, auqResultIds } =
      extractContent(content, globalToolNameMap, auqTracker);
    Object.assign(globalToolNameMap, toolNameMap);

    const answers = auqResultIds.length > 0 ? buildAnswers(record.toolUseResult) : [];

    // When we just built answers, stash `selected` (and `notes`) onto the
    // matching question on the preceding assistant message so the formatter
    // can render the offered options with the picked option marked, without
    // needing back-references between messages.
    if (answers.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const prev = messages[i];
        if (prev.role !== 'assistant') continue;
        if (!prev.questions || prev.questions.length === 0) continue;
        prev.questions = prev.questions.map((q) => {
          const match = answers.find((a) => a.question === q.question);
          if (!match) return q;
          const updated = { ...q, selected: match.selected };
          if (match.notes) updated.notes = match.notes;
          return updated;
        });
        break;
      }
    }

    // Transform user text: drop caveat/stdout noise, rewrite slash commands
    // as compact one-liners, truncate injected skill bodies to their first
    // two non-blank lines.
    let finalText = text;
    if (type === 'user') {
      finalText = text.map(transformUserText).filter((t) => t !== null);
      if (finalText.length === 0 && toolResults.length === 0 && answers.length === 0) continue;
    }

    const message = {
      role: type,
      text: finalText,
      toolCalls,
      toolResults,
      thinking,
      timestamp: ts ?? null,
    };
    if (questions.length > 0) message.questions = questions;
    if (answers.length > 0) message.answers = answers;
    messages.push(message);

    // Inject subagent conversation after Agent tool_use (new file-based format)
    if (type === 'assistant' && subagentFiles.length > 0 && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type !== 'tool_use' || block?.name !== 'Agent') continue;
        const agentDesc = block.input?.description ?? '';
        // Match by description from meta file
        const match = subagentFiles.find((a) => a.description && a.description === agentDesc);
        if (match) {
          for (const subMsg of match.messages) {
            messages.push({
              ...subMsg,
              role: 'subagent',
              agentPrompt: agentDesc,
              agentId: match.agentId,
              timestamp: subMsg.timestamp ?? ts ?? null,
            });
          }
        }
      }
    }
  }

  // Derive session ID from filename if not found in records
  if (!metadata.sessionId) {
    const name = basename(String(jsonlPath), '.jsonl');
    metadata.sessionId = name;
  }

  // Derive project from parent directory
  const pathStr = String(jsonlPath);
  const parentDir = pathStr.split('/').slice(-2, -1)[0] ?? '';
  metadata.project = parentDir ? await resolveProjectName(parentDir, deps) : '';

  metadata.startedAt = firstTimestamp;
  metadata.endedAt = lastTimestamp;

  return { metadata, messages };
}

export function mergeConsecutiveAssistant(messages) {
  const merged = [];

  for (const msg of messages) {
    // User messages that are only tool results (no text) get absorbed
    // into the preceding assistant message — but not if they carry
    // AskUserQuestion answers, which are conversation content.
    if (
      msg.role === 'user' &&
      msg.text.length === 0 &&
      msg.toolResults.length > 0 &&
      (msg.answers?.length ?? 0) === 0
    ) {
      const prev = merged[merged.length - 1];
      if (prev?.role === 'assistant') {
        prev.toolResults = prev.toolResults.concat(msg.toolResults);
        continue;
      }
    }

    if (msg.role === 'assistant') {
      const prev = merged[merged.length - 1];
      if (prev?.role === 'assistant') {
        prev.text = prev.text.concat(msg.text);
        prev.toolCalls = prev.toolCalls.concat(msg.toolCalls);
        prev.toolResults = prev.toolResults.concat(msg.toolResults);
        prev.thinking = prev.thinking.concat(msg.thinking);
        if (msg.questions?.length > 0) {
          prev.questions = (prev.questions ?? []).concat(msg.questions);
        }
        continue;
      }
    }

    merged.push({ ...msg });
  }

  return merged;
}
