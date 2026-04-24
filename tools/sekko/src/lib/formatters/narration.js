/**
 * Format narration transcript into a timestamped markdown document.
 */
export function formatNarration(narration) {
  const lines = [
    '# Narration',
    '',
    `Voice-over transcript (${narration.backend}). Timestamps are relative to recording start.`,
    '',
  ];

  if (!narration.segments || narration.segments.length === 0) {
    if (narration.words && narration.words.length > 0) {
      lines.push(`_${narration.words.length} words transcribed, no segment boundaries available._`);
      lines.push('');
      lines.push(narration.transcript);
    } else {
      lines.push('_No narration transcribed._');
    }
    return lines.join('\n');
  }

  for (const segment of narration.segments) {
    const time = formatTimestamp(segment.startMs);
    lines.push(`**[${time}]** ${segment.text}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
