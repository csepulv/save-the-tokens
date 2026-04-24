import { test, expect, describe } from 'vitest';
import { collapseEvents } from '../parse-user-events.js';
import { extractSelectors } from '../parse-actions.js';

describe('collapseEvents', () => {
  test('collapses sequential input events into a single fill', () => {
    const events = [
      { type: 'input', timestamp: 1, selector: '#search', tag: 'input', url: '/', inputType: 'text', value: 'r' },
      { type: 'input', timestamp: 2, selector: '#search', tag: 'input', url: '/', inputType: 'text', value: 're' },
      { type: 'input', timestamp: 3, selector: '#search', tag: 'input', url: '/', inputType: 'text', value: 'rea' },
      { type: 'input', timestamp: 4, selector: '#search', tag: 'input', url: '/', inputType: 'text', value: 'reac' },
      { type: 'input', timestamp: 5, selector: '#search', tag: 'input', url: '/', inputType: 'text', value: 'react' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('fill');
    expect(result[0].value).toBe('react');
    expect(result[0].selector).toBe('#search');
  });

  test('absorbs change event after input sequence', () => {
    const events = [
      { type: 'input', timestamp: 1, selector: '#field', tag: 'input', url: '/', inputType: 'text', value: 'hi' },
      { type: 'change', timestamp: 2, selector: '#field', tag: 'input', url: '/', inputType: 'text', value: 'hi' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('fill');
    expect(result[0].value).toBe('hi');
  });

  test('absorbs Enter keydown into fill submittedWith', () => {
    const events = [
      { type: 'input', timestamp: 1, selector: '#field', tag: 'input', url: '/', inputType: 'text', value: 'test' },
      { type: 'keydown:Enter', timestamp: 2, selector: '#field', tag: 'input', url: '/' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('fill');
    expect(result[0].submittedWith).toBe('Enter');
  });

  test('merges click-to-focus with subsequent input', () => {
    const events = [
      { type: 'click', timestamp: 1, selector: '#field', tag: 'input', text: null, url: '/' },
      { type: 'input', timestamp: 2, selector: '#field', tag: 'input', url: '/', inputType: 'text', value: 'hello' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('fill');
    expect(result[0].value).toBe('hello');
  });

  test('passes through click events', () => {
    const events = [
      { type: 'click', timestamp: 1, selector: '#btn', tag: 'button', text: 'Submit', url: '/' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('click');
  });

  test('passes through navigation events', () => {
    const events = [
      { type: 'navigation', timestamp: 1, from: '/', url: '/page2', selector: null, tag: null, text: 'Page 2' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('navigation');
  });

  test('handles interleaved actions on different selectors', () => {
    const events = [
      { type: 'input', timestamp: 1, selector: '#a', tag: 'input', url: '/', inputType: 'text', value: 'x' },
      { type: 'click', timestamp: 2, selector: '#btn', tag: 'button', text: 'Go', url: '/' },
      { type: 'input', timestamp: 3, selector: '#b', tag: 'input', url: '/', inputType: 'text', value: 'y' },
    ];

    const result = collapseEvents(events);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('fill');
    expect(result[0].selector).toBe('#a');
    expect(result[1].type).toBe('click');
    expect(result[2].type).toBe('fill');
    expect(result[2].selector).toBe('#b');
  });
});

describe('extractSelectors (shared)', () => {
  test('extracts unique selectors', () => {
    const events = [
      { selector: '#a' },
      { selector: '#b' },
      { selector: '#a' },
      { selector: null },
    ];

    expect(extractSelectors(events)).toEqual(['#a', '#b']);
  });
});
