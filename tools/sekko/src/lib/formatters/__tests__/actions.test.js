import { test, expect, describe } from 'vitest';
import { formatActions } from '../actions.js';

describe('formatActions', () => {
  test('formats user event click', () => {
    const events = [
      { type: 'click', timestamp: 1000, selector: 'button#submit', tag: 'button', text: 'Submit', url: 'https://example.com/' },
    ];

    const md = formatActions(events);
    expect(md).toContain('# Actions');
    expect(md).toContain('Click "Submit"');
    expect(md).toContain('`button#submit`');
  });

  test('formats user event fill with submitted key', () => {
    const events = [
      { type: 'fill', timestamp: 1000, selector: '#search', tag: 'input', value: 'react', submittedWith: 'Enter', url: 'https://example.com/' },
    ];

    const md = formatActions(events);
    expect(md).toContain('Type "react" → Enter');
  });

  test('formats password fill without value', () => {
    const events = [
      { type: 'fill', timestamp: 1000, selector: '#password', tag: 'input', value: null, inputType: 'password', submittedWith: 'Enter', url: 'https://example.com/' },
    ];

    const md = formatActions(events);
    expect(md).toContain('Fill password → Enter');
    expect(md).not.toContain('null');
  });

  test('formats navigation event', () => {
    const events = [
      { type: 'navigation', timestamp: 1000, from: 'https://example.com/', url: 'https://example.com/page2', selector: null, tag: null, text: 'Page Two' },
    ];

    const md = formatActions(events);
    expect(md).toContain('Navigate to https://example.com/page2');
    expect(md).toContain('"Page Two"');
  });

  test('formats trace.trace fallback actions', () => {
    const actions = [
      { callId: 'call@1', class: 'Frame', method: 'goto', params: { url: 'https://example.com' }, startTime: 0, endTime: 2000, selector: null },
    ];

    const md = formatActions(actions);
    expect(md).toContain('Navigate to https://example.com');
  });

  test('shows empty state for no actions', () => {
    const md = formatActions([]);
    expect(md).toContain('No user actions recorded');
  });

  test('numbers actions sequentially', () => {
    const events = [
      { type: 'click', timestamp: 1000, selector: '#a', tag: 'button', text: 'A', url: 'https://example.com/' },
      { type: 'click', timestamp: 2000, selector: '#b', tag: 'button', text: 'B', url: 'https://example.com/' },
    ];

    const md = formatActions(events);
    expect(md).toContain('| 1 |');
    expect(md).toContain('| 2 |');
  });

  test('shows page path in table', () => {
    const events = [
      { type: 'click', timestamp: 1000, selector: '#btn', tag: 'button', text: 'Go', url: 'https://example.com/page?q=test' },
    ];

    const md = formatActions(events);
    expect(md).toContain('/page?q=test');
  });
});
