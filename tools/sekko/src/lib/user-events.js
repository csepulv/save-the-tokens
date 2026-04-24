/**
 * Inject a script into the browser context that captures user interactions
 * (clicks, input, form changes, key presses) with selectors and timestamps.
 *
 * Events are stored in window.__sekko_events and drained via polling.
 */

export const USER_EVENT_INIT_SCRIPT = `
  window.__sekko_events = [];

  function sekkoGetSelector(el) {
    if (!el || !el.tagName) return null;

    // Priority: id > data-testid > aria-label > name attr > role + text > structural
    if (el.id) return '#' + el.id;

    if (el.getAttribute('data-testid'))
      return '[data-testid="' + el.getAttribute('data-testid') + '"]';

    if (el.getAttribute('aria-label'))
      return el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label') + '"]';

    if (el.getAttribute('name'))
      return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';

    if (el.getAttribute('role')) {
      var text = (el.textContent || '').trim().slice(0, 30);
      if (text) return el.getAttribute('role') + ':has-text("' + text + '")';
      return el.tagName.toLowerCase() + '[role="' + el.getAttribute('role') + '"]';
    }

    // href for links
    if (el.tagName === 'A' && el.getAttribute('href')) {
      var href = el.getAttribute('href');
      if (href.length < 80) return 'a[href="' + href + '"]';
    }

    // type for inputs
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      var type = el.getAttribute('type') || el.tagName.toLowerCase();
      var placeholder = el.getAttribute('placeholder');
      if (placeholder) return el.tagName.toLowerCase() + '[placeholder="' + placeholder + '"]';
      return el.tagName.toLowerCase() + '[type="' + type + '"]';
    }

    // Button text
    if (el.tagName === 'BUTTON') {
      var btnText = (el.textContent || '').trim().slice(0, 40);
      if (btnText) return 'button:has-text("' + btnText + '")';
    }

    // Class-based with tag
    var tag = el.tagName.toLowerCase();
    var classes = Array.from(el.classList || []).filter(function(c) {
      return !c.startsWith('css-') && !c.startsWith('_') && c.length < 30;
    }).slice(0, 2);
    if (classes.length > 0) return tag + '.' + classes.join('.');

    // Text content for interactive-looking elements
    var interactiveTags = ['A', 'BUTTON', 'LABEL', 'SUMMARY', 'DETAILS'];
    if (interactiveTags.includes(el.tagName)) {
      var elText = (el.textContent || '').trim().slice(0, 40);
      if (elText) return tag + ':has-text("' + elText + '")';
    }

    return tag;
  }

  function sekkoFindMeaningfulTarget(el) {
    // Walk up from the event target to find the most meaningful element.
    // Clicks on spans inside buttons should report the button.
    var current = el;
    var interactiveTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY'];
    for (var i = 0; i < 5 && current && current !== document.body; i++) {
      if (interactiveTags.includes(current.tagName)) return current;
      if (current.getAttribute('role') === 'button') return current;
      if (current.getAttribute('data-testid')) return current;
      if (current.onclick || current.getAttribute('tabindex')) return current;
      current = current.parentElement;
    }
    return el;
  }

  function sekkoRecord(type, event) {
    var raw = event.target;
    if (!raw || !raw.tagName) return;

    var el = (type === 'click') ? sekkoFindMeaningfulTarget(raw) : raw;
    var selector = sekkoGetSelector(el);
    if (!selector) return;

    var entry = {
      type: type,
      timestamp: Date.now(),
      selector: selector,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 80) || null,
      url: window.location.href,
    };

    if (type === 'input' || type === 'change') {
      entry.inputType = el.getAttribute('type') || el.tagName.toLowerCase();
      // Don't capture password values
      if (el.getAttribute('type') !== 'password') {
        entry.value = (el.value || '').slice(0, 100) || null;
      }
    }

    window.__sekko_events.push(entry);
  }

  // Navigation tracking
  var sekkoLastUrl = window.location.href;
  function sekkoCheckNavigation() {
    if (window.location.href !== sekkoLastUrl) {
      window.__sekko_events.push({
        type: 'navigation',
        timestamp: Date.now(),
        from: sekkoLastUrl,
        url: window.location.href,
        selector: null,
        tag: null,
        text: document.title || null,
      });
      sekkoLastUrl = window.location.href;
    }
  }

  document.addEventListener('click', function(e) { sekkoRecord('click', e); }, true);
  document.addEventListener('input', function(e) { sekkoRecord('input', e); }, true);
  document.addEventListener('change', function(e) { sekkoRecord('change', e); }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
      sekkoRecord('keydown:' + e.key, e);
    }
  }, true);

  // Catch SPA navigations
  setInterval(sekkoCheckNavigation, 300);

  // Catch popstate (back/forward)
  window.addEventListener('popstate', function() {
    setTimeout(sekkoCheckNavigation, 50);
  });
`;

/**
 * Start polling pages for user events. Returns a controller with
 * stop() to end polling and getEvents() to retrieve collected events.
 */
export function startEventPolling(context, intervalMs = 500) {
  const events = [];

  const timer = setInterval(async () => {
    try {
      for (const page of context.pages()) {
        const batch = await page.evaluate(() => {
          const e = window.__sekko_events || [];
          window.__sekko_events = [];
          return e;
        });
        events.push(...batch);
      }
    } catch {
      // page may be closing — ignore
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
    getEvents() {
      return events;
    },
  };
}
