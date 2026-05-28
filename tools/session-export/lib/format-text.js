import { buildFrontmatter, normalizeFormatOptions } from './format-shared.js';
import { truncateSkillBody } from './parse.js';

function truncate(text, maxLen = 500) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function selectionMatchesOption(selected, options) {
  return Array.isArray(options) && options.some((o) => o.label === selected);
}

function formatQuestionLines(q, includeAll) {
  const headerPart = q.header ? ` (${q.header})` : '';
  const lines = [`Q${headerPart}: ${q.question ?? ''}`];

  if (includeAll && Array.isArray(q.options) && q.options.length > 0) {
    const matched = selectionMatchesOption(q.selected, q.options);
    for (const opt of q.options) {
      const isPicked = matched && opt.label === q.selected;
      const marker = isPicked ? '[x]' : '[ ]';
      const desc = opt.description ? ` — ${opt.description}` : '';
      lines.push(`  ${marker} ${opt.label}${desc}`);
    }
  }

  return lines;
}

function formatAnswerLine(a, includeAll) {
  const headerPart = a.header ? ` (${a.header})` : '';
  const matched = selectionMatchesOption(a.selected, a.options);

  if (!matched && a.notes) {
    return `A${headerPart}: Other — "${a.notes}"`;
  }
  if (!matched) {
    return `A${headerPart}: ${a.selected ?? ''}`;
  }

  const checkmark = includeAll ? '✓ ' : '';
  let line = `A${headerPart}: ${checkmark}${a.selected}`;
  if (a.notes) line += ` — note: "${a.notes}"`;
  return line;
}

export function formatText(conversation, options = {}) {
  const opts = normalizeFormatOptions(options);

  const output = [];

  // Frontmatter (same as markdown)
  output.push(buildFrontmatter(conversation.metadata, options));
  output.push('');

  let activeAgentId = null;

  for (let message of conversation.messages) {
    if (message.role === 'user' && !opts.includeSkillText) {
      message = { ...message, text: message.text.map(truncateSkillBody) };
    }

    // Handle subagent messages
    if (message.role === 'subagent') {
      if (!opts.includeAll) continue;

      if (message.agentId !== activeAgentId) {
        if (activeAgentId !== null) {
          output.push('  --- End Subagent ---');
          output.push('');
        }
        activeAgentId = message.agentId;
        const prompt = message.agentPrompt ?? 'unknown';
        output.push(`  --- Subagent: ${truncate(prompt, 120)} ---`);
      }

      const prefix = '    ';
      for (const thought of message.thinking) {
        output.push(`${prefix}[Thinking: ${truncate(thought)}]`);
      }
      for (const text of message.text) {
        output.push(`${prefix}${text}`);
      }
      for (const call of message.toolCalls) {
        output.push(`${prefix}${call}`);
      }
      for (const result of message.toolResults) {
        const display = opts.includeAll ? result.content : truncate(result.content);
        output.push(`${prefix}[Result for ${result.toolName}: ${display}]`);
      }
      continue;
    }

    // Close any open subagent block
    if (activeAgentId !== null) {
      activeAgentId = null;
      output.push('  --- End Subagent ---');
      output.push('');
    }

    // Skip system unless requested
    if (message.role === 'system' && !opts.includeSystem) continue;

    // Build content lines
    const lines = [];

    if (opts.includeAll) {
      for (const thought of message.thinking) {
        lines.push(`  [Thinking: ${truncate(thought)}]`);
      }
    }

    for (const text of message.text) {
      lines.push(text);
    }

    if (opts.includeTools) {
      for (const call of message.toolCalls) {
        lines.push(`  ${call}`);
      }
    }

    // AskUserQuestion: questions on assistant turns, answers on user turns —
    // always rendered (conversation, not tool traffic).
    if (message.role === 'assistant' && message.questions?.length > 0) {
      for (const q of message.questions) {
        lines.push(...formatQuestionLines(q, opts.includeAll));
      }
    }
    if (message.role === 'user' && message.answers?.length > 0) {
      for (const a of message.answers) {
        lines.push(formatAnswerLine(a, opts.includeAll));
      }
    }

    if (opts.includeAll) {
      for (const result of message.toolResults) {
        lines.push(`  [Result for ${result.toolName}: ${result.content}]`);
      }
    }

    // Skip user messages with no text and no answers (tool-result-only turns)
    if (message.role === 'user' && message.text.length === 0 && (message.answers?.length ?? 0) === 0) {
      if (opts.includeAll && message.toolResults.length > 0) {
        const header = opts.includeTimestamps && message.timestamp
          ? `=== USER [${message.timestamp}] ===`
          : '=== USER ===';
        output.push(header);
        output.push(...lines);
        output.push('');
      }
      continue;
    }

    // Skip assistant messages with no visible content
    if (message.role === 'assistant' && lines.length === 0) continue;

    const header = opts.includeTimestamps && message.timestamp
      ? `=== ${message.role.toUpperCase()} [${message.timestamp}] ===`
      : `=== ${message.role.toUpperCase()} ===`;
    output.push(header);
    output.push(...lines);
    output.push('');
  }

  // Close any trailing subagent block
  if (activeAgentId !== null) {
    output.push('  --- End Subagent ---');
    output.push('');
  }

  return output.join('\n').trimEnd() + '\n';
}
