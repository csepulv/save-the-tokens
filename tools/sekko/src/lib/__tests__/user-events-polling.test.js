import { test, expect, describe, vi } from 'vitest';
import { startEventPolling } from '../user-events.js';

// Test that polling iterates each page independently — a failure on
// one page (e.g. a privileged chrome:// URL where evaluate throws)
// must not prevent collection from the other pages.

function makePage({ events = [], throws = false } = {}) {
  return {
    evaluate: vi.fn(async () => {
      if (throws) throw new Error('Cannot access chrome:// page');
      const out = events.slice();
      events.length = 0;
      return out;
    }),
  };
}

function makeContext(pages) {
  return {
    pages: () => pages,
  };
}

describe('startEventPolling', () => {
  test('collects events from a single page', async () => {
    const page = makePage({ events: [{ type: 'click', timestamp: 1 }] });
    const ctx = makeContext([page]);

    const poller = startEventPolling(ctx, 50);
    await new Promise((r) => setTimeout(r, 80));
    poller.stop();

    expect(poller.getEvents()).toEqual([{ type: 'click', timestamp: 1 }]);
  });

  test('a failing page does NOT prevent collection from other pages', async () => {
    // This is the bug Chris hit on a real recording: a chrome:// new-tab-page
    // was open in the same context as the recorded JD app. The poller's
    // single try/catch wrapped the for-loop, so when evaluate() threw on
    // the chrome:// page, the JD page never got polled.
    const goodPage = makePage({ events: [{ type: 'click', selector: '#btn' }] });
    const badPage = makePage({ throws: true });
    const ctx = makeContext([badPage, goodPage]); // bad page FIRST in iteration

    const poller = startEventPolling(ctx, 50);
    await new Promise((r) => setTimeout(r, 80));
    poller.stop();

    expect(poller.getEvents()).toEqual([{ type: 'click', selector: '#btn' }]);
    expect(badPage.evaluate).toHaveBeenCalled();
    expect(goodPage.evaluate).toHaveBeenCalled();
  });

  test('handles all pages failing without crashing', async () => {
    const ctx = makeContext([
      makePage({ throws: true }),
      makePage({ throws: true }),
    ]);
    const poller = startEventPolling(ctx, 50);
    await new Promise((r) => setTimeout(r, 80));
    poller.stop();
    expect(poller.getEvents()).toEqual([]);
  });

  test('accumulates events across multiple poll cycles', async () => {
    const eventQueue = [
      [{ type: 'click', n: 1 }],
      [{ type: 'click', n: 2 }],
      [],
    ];
    const page = {
      evaluate: vi.fn(async () => eventQueue.shift() || []),
    };
    const ctx = makeContext([page]);

    const poller = startEventPolling(ctx, 30);
    await new Promise((r) => setTimeout(r, 120));
    poller.stop();

    expect(poller.getEvents().length).toBeGreaterThanOrEqual(2);
  });
});
