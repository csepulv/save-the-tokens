import { buildFrontmatter, normalizeFormatOptions } from './format-shared.js';
import { mergeConsecutiveAssistant, truncateSkillBody } from './parse.js';

function roleLabel(role, timestamp) {
  const name =
    role === 'user' ? 'User'
    : role === 'assistant' ? 'Assistant'
    : role === 'system' ? 'System'
    : role;
  const base = `**${name}**`;
  return timestamp ? `${base} · _${timestamp}_` : base;
}

function formatToolCall(call, result) {
  const lines = [];
  lines.push(`<details>`);
  lines.push(`<summary><code>${call}</code></summary>`);
  if (result) {
    lines.push('');
    lines.push('```');
    lines.push(result);
    lines.push('```');
    lines.push('');
  }
  lines.push(`</details>`);
  return lines.join('\n');
}

function selectionMatchesOption(selected, options) {
  return Array.isArray(options) && options.some((o) => o.label === selected);
}

function formatQuestion(q, includeAll) {
  const headerPart = q.header ? ` (${q.header})` : '';
  const lines = [`**Q${headerPart}:** ${q.question ?? ''}`];

  if (includeAll && Array.isArray(q.options) && q.options.length > 0) {
    lines.push('');
    const matched = selectionMatchesOption(q.selected, q.options);
    for (const opt of q.options) {
      const isPicked = matched && opt.label === q.selected;
      const label = isPicked ? `**${opt.label}**` : opt.label;
      const desc = opt.description ? ` — ${opt.description}` : '';
      lines.push(`- ${label}${desc}`);
    }
  }

  return lines.join('\n');
}

function formatAnswer(a, includeAll) {
  const headerPart = a.header ? ` (${a.header})` : '';
  const matched = selectionMatchesOption(a.selected, a.options);

  if (!matched && a.notes) {
    return `**A${headerPart}:** Other — "${a.notes}"`;
  }
  if (!matched) {
    // Free-text without notes — render the selected text as-is.
    return `**A${headerPart}:** ${a.selected ?? ''}`;
  }

  const checkmark = includeAll ? '✓ ' : '';
  let line = `**A${headerPart}:** ${checkmark}${a.selected}`;
  if (a.notes) line += ` — note: "${a.notes}"`;
  return line;
}

function formatThinking(thought) {
  const lines = [];
  lines.push('<details>');
  lines.push('<summary>Thinking</summary>');
  lines.push('');
  lines.push(thought);
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

function formatSubagentBlock(messages, prompt, options) {
  const lines = [];
  lines.push('<details>');
  lines.push(`<summary>Subagent: ${prompt ?? 'unknown'}</summary>`);
  lines.push('');

  for (const msg of messages) {
    for (const text of msg.text) {
      lines.push(text);
      lines.push('');
    }
    if (options.includeTools) {
      for (const call of msg.toolCalls) {
        lines.push(`\`${call}\``);
        lines.push('');
      }
    }
  }

  lines.push('</details>');
  return lines.join('\n');
}

function formatSystemMessage(message, includeAll) {
  const content = message.text.join('\n').trim();
  if (!content) return null;

  if (includeAll) {
    const lines = [];
    lines.push('<details>');
    lines.push(`<summary>System</summary>`);
    lines.push('');
    lines.push(content);
    lines.push('');
    lines.push('</details>');
    return lines.join('\n');
  }

  // Short form: italic between rules
  const oneLine = content.replace(/\n/g, ' ').slice(0, 200);
  return `*System: ${oneLine}*`;
}

function formatMessage(message, options) {
  const { includeTools, includeAll } = options;
  const lines = [];

  // Thinking blocks (--include-all only)
  if (includeAll && message.thinking.length > 0) {
    for (const thought of message.thinking) {
      lines.push(formatThinking(thought));
      lines.push('');
    }
  }

  // Tool calls
  if (includeTools && message.toolCalls.length > 0) {
    // Build a map from tool call index to result (if includeAll)
    const resultMap = {};
    if (includeAll && message.toolResults.length > 0) {
      // Match results to calls by order (tool results correspond to tool calls in sequence)
      for (let i = 0; i < message.toolResults.length && i < message.toolCalls.length; i++) {
        resultMap[i] = message.toolResults[i].content;
      }
    }

    for (let i = 0; i < message.toolCalls.length; i++) {
      lines.push(formatToolCall(message.toolCalls[i], resultMap[i] ?? null));
      lines.push('');
    }
  }

  // Text content
  for (const text of message.text) {
    lines.push(text);
    lines.push('');
  }

  // AskUserQuestion: questions render on assistant turns, answers on user
  // turns — regardless of include-tools/include-all (they're conversation,
  // not tool traffic). includeAll expands the offered options under each Q.
  if (message.role === 'assistant' && message.questions?.length > 0) {
    for (const q of message.questions) {
      lines.push(formatQuestion(q, includeAll));
      lines.push('');
    }
  }
  if (message.role === 'user' && message.answers?.length > 0) {
    for (const a of message.answers) {
      lines.push(formatAnswer(a, includeAll));
      lines.push('');
    }
  }

  // Tool results on user messages (--include-all, when no tool calls to pair with)
  if (includeAll && message.role === 'user' && message.toolResults.length > 0 && message.toolCalls.length === 0) {
    for (const result of message.toolResults) {
      lines.push(`**Result for ${result.toolName}:**`);
      lines.push('');
      lines.push('```');
      lines.push(result.content);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function formatMarkdown(conversation, options = {}) {
  const effectiveOptions = normalizeFormatOptions(options);

  const sections = [];

  // Frontmatter
  sections.push(buildFrontmatter(conversation.metadata, options));
  sections.push('');

  // Title heading
  const title = conversation.metadata.customTitle || conversation.metadata.sessionId || 'Conversation';
  sections.push(`# ${title}`);

  // Merge consecutive assistant messages
  const messages = mergeConsecutiveAssistant(conversation.messages);

  // Track subagent blocks for grouping
  let activeAgentId = null;
  const subagentBuffer = [];
  let subagentPrompt = null;

  function flushSubagent() {
    if (subagentBuffer.length > 0) {
      sections.push('');
      sections.push(formatSubagentBlock(subagentBuffer, subagentPrompt, effectiveOptions));
    }
    subagentBuffer.length = 0;
    activeAgentId = null;
    subagentPrompt = null;
  }

  for (let message of messages) {
    if (message.role === 'user' && !effectiveOptions.includeSkillText) {
      message = { ...message, text: message.text.map(truncateSkillBody) };
    }

    // Handle subagent messages
    if (message.role === 'subagent') {
      if (!effectiveOptions.includeAll) continue;

      if (message.agentId !== activeAgentId) {
        flushSubagent();
        activeAgentId = message.agentId;
        subagentPrompt = message.agentPrompt;
      }
      subagentBuffer.push(message);
      continue;
    }

    // Flush any pending subagent block
    if (activeAgentId !== null) flushSubagent();

    // System messages
    if (message.role === 'system') {
      if (!effectiveOptions.includeSystem) continue;
      const formatted = formatSystemMessage(message, effectiveOptions.includeAll);
      if (formatted) {
        sections.push('');
        sections.push('---');
        sections.push('');
        sections.push(formatted);
      }
      continue;
    }

    // Skip user messages that are only tool results (unless includeAll).
    // User messages carrying AUQ answers are conversation — never skipped.
    if (message.role === 'user' && message.text.length === 0 && (message.answers?.length ?? 0) === 0) {
      if (!effectiveOptions.includeAll || message.toolResults.length === 0) continue;
    }

    const content = formatMessage(message, effectiveOptions);

    // Skip assistant messages with no visible content
    if (message.role === 'assistant' && !content.trim()) continue;

    sections.push('');
    sections.push('---');
    sections.push('');
    sections.push(roleLabel(message.role, effectiveOptions.includeTimestamps ? message.timestamp : null));
    sections.push('');
    sections.push(content.trimEnd());
  }

  // Flush any trailing subagent block
  if (activeAgentId !== null) flushSubagent();

  return sections.join('\n').trimEnd() + '\n';
}
