import { test, expect, describe } from 'vitest';
import { formatSelectors } from '../selectors.js';

describe('formatSelectors', () => {
  test('formats selectors as bullet list', () => {
    const selectors = ['button#submit', 'input[name="email"]', 'a.nav-link'];

    const md = formatSelectors(selectors);
    expect(md).toContain('# Selectors');
    expect(md).toContain('- `button#submit`');
    expect(md).toContain('- `input[name="email"]`');
    expect(md).toContain('- `a.nav-link`');
  });

  test('shows empty state for no selectors', () => {
    const md = formatSelectors([]);
    expect(md).toContain('No selectors captured');
  });
});
