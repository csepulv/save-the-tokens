import { test, expect, describe } from 'vitest';
import { formatSummary } from '../summary.js';

describe('formatSummary', () => {
  test('includes all artifact references', () => {
    const md = formatSummary({
      actionCount: 5,
      selectorCount: 3,
      networkCount: 20,
      screenshotCount: 10,
      outputDir: '/tmp/output',
    });

    expect(md).toContain('# Trace Extraction Summary');
    expect(md).toContain('[actions.md](./actions.md)');
    expect(md).toContain('[network.md](./network.md)');
    expect(md).toContain('[selectors.md](./selectors.md)');
    expect(md).toContain('[screenshots/](./screenshots/)');
    expect(md).toContain('5 actions');
    expect(md).toContain('20 requests');
    expect(md).toContain('3 selectors');
    expect(md).toContain('10 images');
  });

  test('includes usage instructions', () => {
    const md = formatSummary({
      actionCount: 0,
      selectorCount: 0,
      networkCount: 0,
      screenshotCount: 0,
      outputDir: '/tmp/output',
    });

    expect(md).toContain('How to Use These Artifacts');
    expect(md).toContain('Quick Reference');
  });
});
