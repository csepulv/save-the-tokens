import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load user-events.json from the output directory and collapse
 * sequential input events into single "typed" actions.
 */
export function parseUserEvents(eventsPath) {
  const raw = JSON.parse(readFileSync(eventsPath, 'utf-8'));
  return collapseEvents(raw);
}

/**
 * Collapse raw user events into meaningful actions:
 * - Sequential input events on the same selector → single "fill" with final value
 * - Change events immediately after input → absorbed into the fill
 * - Click + input sequence on same selector → single "fill" (click to focus + typing)
 */
export function collapseEvents(events) {
  const collapsed = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];

    // Collapse sequential input events on the same selector
    if (event.type === 'input') {
      const selector = event.selector;
      let lastInput = event;
      let j = i + 1;

      while (j < events.length) {
        const next = events[j];
        if (next.selector === selector && (next.type === 'input' || next.type === 'change')) {
          lastInput = next;
          j++;
        } else {
          break;
        }
      }

      // If the previous collapsed event was a click on the same selector, merge
      const prev = collapsed[collapsed.length - 1];
      if (prev && prev.type === 'click' && prev.selector === selector) {
        collapsed.pop();
      }

      collapsed.push({
        type: 'fill',
        timestamp: event.timestamp,
        selector,
        tag: event.tag,
        value: lastInput.value || null,
        inputType: event.inputType || null,
        url: event.url,
      });

      i = j;
      continue;
    }

    // Skip standalone change events (already absorbed by input collapse)
    if (event.type === 'change') {
      i++;
      continue;
    }

    // Skip keydown:Enter/Tab if the previous action was a fill on the same selector
    // (the Enter submits the form — the fill already captured the value)
    if (event.type?.startsWith('keydown:')) {
      const key = event.type.split(':')[1];
      const prev = collapsed[collapsed.length - 1];
      if (prev && prev.type === 'fill' && prev.selector === event.selector) {
        prev.submittedWith = key;
        i++;
        continue;
      }

      // Standalone keypress
      collapsed.push({
        type: 'keypress',
        timestamp: event.timestamp,
        selector: event.selector,
        tag: event.tag,
        key,
        url: event.url,
      });
      i++;
      continue;
    }

    // Pass through clicks, navigations as-is
    collapsed.push(event);
    i++;
  }

  return collapsed;
}

