import { buildFrontmatter, normalizeFormatOptions } from './format-shared.js';
import { truncateSkillBody } from './parse.js';

function truncate(text, maxLen = 500) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
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

    if (opts.includeAll) {
      for (const result of message.toolResults) {
        lines.push(`  [Result for ${result.toolName}: ${result.content}]`);
      }
    }

    // Skip user messages with no text (tool-result-only turns)
    if (message.role === 'user' && message.text.length === 0) {
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
