'use strict';

const { FallbackTracker, READ_ONLY_FALLBACK_TOOLS } = require('../../src/tools/fallback');

describe('FallbackTracker — trackFallbackUse', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FallbackTracker();
  });

  test('sets nudgePending and everUsed for non-read-only tools', () => {
    expect(tracker.nudgePending).toBe(false);
    expect(tracker.everUsed).toBe(false);

    tracker.trackFallbackUse('browser_click', 'ref: "e12"');

    expect(tracker.nudgePending).toBe(true);
    expect(tracker.everUsed).toBe(true);
  });

  test('does NOT set flags for read-only tools', () => {
    const readOnlyTools = [
      'browser_snapshot',
      'browser_console_messages',
      'browser_network_requests',
      'browser_tabs',
      'browser_take_screenshot',
    ];

    for (const tool of readOnlyTools) {
      tracker.trackFallbackUse(tool, '');
      expect(tracker.nudgePending).toBe(false);
      expect(tracker.everUsed).toBe(false);
    }
  });

  test('returns true for non-read-only tools', () => {
    expect(tracker.trackFallbackUse('browser_click', '')).toBe(true);
    expect(tracker.trackFallbackUse('browser_type', '')).toBe(true);
    expect(tracker.trackFallbackUse('browser_fill_form', '')).toBe(true);
  });

  test('returns false for read-only tools', () => {
    expect(tracker.trackFallbackUse('browser_snapshot', '')).toBe(false);
    expect(tracker.trackFallbackUse('browser_take_screenshot', '')).toBe(false);
  });

  test('tracks tool usage in toolsUsed array', () => {
    tracker.trackFallbackUse('browser_click', 'ref: "e12"');
    tracker.trackFallbackUse('browser_type', 'ref: "e5"');
    tracker.trackFallbackUse('browser_click', 'ref: "e20"'); // duplicate tool name

    expect(tracker.toolsUsed).toEqual(['browser_click', 'browser_type']);
  });

  test('appends to actionLog', () => {
    tracker.trackFallbackUse('browser_click', 'ref: "e12"');
    tracker.trackFallbackUse('browser_type', 'ref: "e5", text: "hello"');

    expect(tracker.actionLog).toHaveLength(2);
    expect(tracker.actionLog[0]).toEqual({ tool: 'browser_click', args: 'ref: "e12"' });
    expect(tracker.actionLog[1]).toEqual({ tool: 'browser_type', args: 'ref: "e5", text: "hello"' });
  });
});

describe('FallbackTracker — isReadOnly', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FallbackTracker();
  });

  test('returns true for all READ_ONLY_FALLBACK_TOOLS', () => {
    for (const tool of READ_ONLY_FALLBACK_TOOLS) {
      expect(tracker.isReadOnly(tool)).toBe(true);
    }
  });

  test('returns false for non-read-only tools', () => {
    expect(tracker.isReadOnly('browser_click')).toBe(false);
    expect(tracker.isReadOnly('browser_type')).toBe(false);
    expect(tracker.isReadOnly('browser_fill_form')).toBe(false);
    expect(tracker.isReadOnly('browser_hover')).toBe(false);
  });
});

describe('FallbackTracker — reset', () => {
  test('clears all state', () => {
    const tracker = new FallbackTracker();

    // Populate state
    tracker.trackFallbackUse('browser_click', 'ref: "e1"');
    tracker.trackFallbackPromotion('my-tool', '#old', '#new');
    tracker.extractionHintShown = true;
    tracker.savedToolCategories.add('form');

    expect(tracker.nudgePending).toBe(true);
    expect(tracker.everUsed).toBe(true);
    expect(tracker.toolsUsed).toHaveLength(1);
    expect(tracker.actionLog).toHaveLength(1);
    expect(tracker.fallbackPromotions).toHaveLength(1);

    tracker.reset();

    expect(tracker.nudgePending).toBe(false);
    expect(tracker.everUsed).toBe(false);
    expect(tracker.extractionHintShown).toBe(false);
    expect(tracker.toolsUsed).toEqual([]);
    expect(tracker.actionLog).toEqual([]);
    expect(tracker.savedToolCategories.size).toBe(0);
    expect(tracker.fallbackPromotions).toEqual([]);
  });
});

describe('FallbackTracker — buildSaveNudge', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FallbackTracker();
  });

  test('includes action log steps', () => {
    tracker.trackFallbackUse('browser_click', 'ref: "e12"');
    tracker.trackFallbackUse('browser_type', 'ref: "e5", text: "hello"');

    const nudge = tracker.buildSaveNudge('example.com', [], []);
    expect(nudge).toContain('browser_click');
    expect(nudge).toContain('browser_type');
    expect(nudge).toContain('Steps you performed');
  });

  test('mentions existing tools when present', () => {
    tracker.trackFallbackUse('browser_click', '');

    const tools = [{ name: 'search-products' }, { name: 'add-to-cart' }];
    const nudge = tracker.buildSaveNudge('example.com', tools, []);

    expect(nudge).toContain('search-products');
    expect(nudge).toContain('add-to-cart');
    expect(nudge).toContain('Existing tools for example.com');
  });

  test('includes create-config checklist when no configs exist', () => {
    tracker.trackFallbackUse('browser_click', '');
    const nudge = tracker.buildSaveNudge('example.com', [], []);

    expect(nudge).toContain('add_create-config');
  });

  test('omits create-config checklist when configs exist', () => {
    tracker.trackFallbackUse('browser_click', '');
    const nudge = tracker.buildSaveNudge('example.com', [], [{ id: 'cfg-1' }]);

    expect(nudge).not.toContain('Call add_create-config');
  });
});

describe('FallbackTracker — buildFallbackListReminder', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FallbackTracker();
  });

  test('includes domain tools when they exist', () => {
    const tools = [{ name: 'search-items' }, { name: 'extract-data' }];
    const reminder = tracker.buildFallbackListReminder('shop.com', tools);

    expect(reminder).toContain('search-items');
    expect(reminder).toContain('extract-data');
    expect(reminder).toContain('shop.com');
    expect(reminder).toContain('xbot_execute');
  });

  test('mentions no tools when domain has none', () => {
    const reminder = tracker.buildFallbackListReminder('new-site.com', []);
    expect(reminder).toContain('No saved tools for new-site.com');
  });

  test('returns empty string when no domain', () => {
    const reminder = tracker.buildFallbackListReminder(null, []);
    expect(reminder).toBe('');
  });
});

describe('FallbackTracker — buildSaveReminder', () => {
  test('includes tool name', () => {
    const tracker = new FallbackTracker();
    const reminder = tracker.buildSaveReminder('browser_click');

    expect(reminder).toContain('browser_click');
    expect(reminder).toContain('save-reminder');
    expect(reminder).toContain('add_tool');
  });
});

describe('FallbackTracker — trackFallbackPromotion (Phase 2)', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FallbackTracker();
  });

  test('records promotion with timestamp', () => {
    const before = Date.now();
    tracker.trackFallbackPromotion('search-tool', '#old-selector', '#new-selector');
    const after = Date.now();

    expect(tracker.fallbackPromotions).toHaveLength(1);
    const promo = tracker.fallbackPromotions[0];
    expect(promo.toolName).toBe('search-tool');
    expect(promo.oldSelector).toBe('#old-selector');
    expect(promo.newSelector).toBe('#new-selector');
    expect(promo.timestamp).toBeGreaterThanOrEqual(before);
    expect(promo.timestamp).toBeLessThanOrEqual(after);
  });

  test('handles object selectors by JSON.stringifying', () => {
    const oldSel = { css: '.old', role: 'button' };
    const newSel = { css: '.new', role: 'link' };
    tracker.trackFallbackPromotion('my-tool', oldSel, newSel);

    const promo = tracker.fallbackPromotions[0];
    expect(promo.oldSelector).toBe(JSON.stringify(oldSel));
    expect(promo.newSelector).toBe(JSON.stringify(newSel));
  });

  test('allows multiple promotions', () => {
    tracker.trackFallbackPromotion('tool-a', '#s1', '#s2');
    tracker.trackFallbackPromotion('tool-b', '#s3', '#s4');
    tracker.trackFallbackPromotion('tool-c', '#s5', '#s6');

    expect(tracker.fallbackPromotions).toHaveLength(3);
  });

  test('fallbackPromotions is reset on reset()', () => {
    tracker.trackFallbackPromotion('tool-a', '#old', '#new');
    expect(tracker.fallbackPromotions).toHaveLength(1);

    tracker.reset();
    expect(tracker.fallbackPromotions).toEqual([]);
  });
});
