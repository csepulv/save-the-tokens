import { derivePageLabel } from '../page-labels.js';

/**
 * Format user events (collapsed) into a markdown action log.
 * Falls back to trace.trace actions if no user events are available.
 */
export function formatActions(events) {
  const lines = [
    '# Actions',
    '',
    'Chronological log of user actions recorded during the session.',
    '',
  ];

  if (events.length === 0) {
    lines.push('_No user actions recorded._');
    return lines.join('\n');
  }

  const hasRequests = events.some((e) => e.requestIds?.length > 0);

  if (hasRequests) {
    lines.push('| # | Action | Selector | Page | Requests |');
    lines.push('|---|--------|----------|------|----------|');
  } else {
    lines.push('| # | Action | Selector | Page |');
    lines.push('|---|--------|----------|------|');
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const description = formatEventDescription(e);
    const selector = e.selector ? `\`${e.selector}\`` : '—';
    const page = formatPageUrl(e.url);
    const requests = formatRequestIds(e.requestIds);

    if (hasRequests) {
      lines.push(`| ${i + 1} | ${description} | ${selector} | ${page} | ${requests} |`);
    } else {
      lines.push(`| ${i + 1} | ${description} | ${selector} | ${page} |`);
    }
  }

  return lines.join('\n');
}

function formatEventDescription(event) {
  const { type } = event;

  if (type === 'navigation') {
    const title = event.text ? ` "${event.text}"` : '';
    return `Navigate to ${event.url}${title}`;
  }

  if (type === 'page-opened') {
    const label = derivePageLabel(event.url);
    if (label) return `Open ${label}`;
    return `Open new page: ${event.url}`;
  }

  if (type === 'click') {
    const text = event.text ? ` "${truncate(event.text, 40)}"` : '';
    return `Click${text}`;
  }

  if (type === 'fill') {
    if (event.inputType === 'password') {
      const submit = event.submittedWith ? ` → ${event.submittedWith}` : '';
      return `Fill password${submit}`;
    }
    const value = event.value ? `"${truncate(event.value, 40)}"` : '(empty)';
    const submit = event.submittedWith ? ` → ${event.submittedWith}` : '';
    return `Type ${value}${submit}`;
  }

  if (type === 'keypress') {
    return `Press ${event.key}`;
  }

  // Fallback for trace.trace actions (backward compat)
  if (event.method) {
    return formatTraceAction(event);
  }

  return type;
}

function formatTraceAction(action) {
  const { method, params } = action;
  if (method === 'goto') return `Navigate to ${params?.url || '(unknown)'}`;
  if (method === 'click') return `Click \`${params?.selector || '(unknown)'}\``;
  if (method === 'fill') return `Fill \`${params?.selector || '(unknown)'}\` with "${params?.value || ''}"`;
  if (method === 'newPage') return 'New page opened';
  return `${action.class}.${method}`;
}

function formatPageUrl(url) {
  if (!url) return '—';
  const label = derivePageLabel(url);
  if (label) return label;
  try {
    const u = new URL(url);
    const path = u.pathname + u.search + u.hash;
    return path.length > 60 ? path.slice(0, 57) + '...' : path;
  } catch {
    return url;
  }
}

function formatRequestIds(ids) {
  if (!ids || ids.length === 0) return '—';
  if (ids.length <= 3) return ids.map((id) => `#${id}`).join(', ');
  return `#${ids[0]}, #${ids[1]}, … (${ids.length} total)`;
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}
