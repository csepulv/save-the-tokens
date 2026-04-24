/**
 * Format unique selectors into markdown.
 */
export function formatSelectors(selectors) {
  const lines = [
    '# Selectors',
    '',
    'Unique selectors discovered during the session. These target interactive elements the user engaged with.',
    '',
  ];

  if (selectors.length === 0) {
    lines.push('_No selectors captured (no interactive actions recorded)._');
    return lines.join('\n');
  }

  for (const selector of selectors) {
    lines.push(`- \`${selector}\``);
  }

  return lines.join('\n');
}
