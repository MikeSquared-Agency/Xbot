'use strict';

const {
  translateStep,
  translateAction,
  translateWorkflow,
  selectorToLocator,
  selectorToCss,
  isPlaywrightSelector,
} = require('../../src/action-translator');

// Helper: run translateStep and return the generated lines
function stepLines(step, args = {}) {
  const lines = [];
  const vars = new Set();
  translateStep(step, lines, vars, args);
  return { lines, vars };
}

describe('translateStep — navigate', () => {
  test('generates page.goto()', () => {
    const { lines } = stepLines({ action: 'navigate', url: 'https://example.com' });
    const code = lines.join('\n');
    expect(code).toContain('page.goto(');
    expect(code).toContain('https://example.com');
  });

  test('substitutes {param} from args in url', () => {
    const { lines } = stepLines(
      { action: 'navigate', url: 'https://example.com/{query}' },
      { query: 'hello' }
    );
    const code = lines.join('\n');
    expect(code).toContain('hello');
  });

  test('substitutes {param} from args in urlTemplate', () => {
    const { lines } = stepLines(
      { action: 'navigate', urlTemplate: 'https://x.com/search?q={query}' },
      { query: 'test search' }
    );
    const code = lines.join('\n');
    expect(code).toContain('page.goto(');
    expect(code).toContain('query');
  });
});

describe('translateStep — click', () => {
  test('generates locator click with fallback selector loop', () => {
    const { lines } = stepLines({ action: 'click', selector: '#btn' });
    const code = lines.join('\n');
    expect(code).toContain('page.locator');
    expect(code).toContain('isVisible');
    expect(code).toContain('.click()');
    expect(code).toContain('_clicked');
  });

  test('generates Bezier mouse movement with humanLike: true', () => {
    const { lines } = stepLines({ action: 'click', selector: '#btn', humanLike: true });
    const code = lines.join('\n');
    expect(code).toContain('mouse.move');
    // Bezier control points are present (cubic Bezier curve implementation)
    expect(code).toContain('_cp1x');
    expect(code).toContain('_cp2x');
    expect(code).toContain('boundingBox');
  });

  test('does NOT generate Bezier code without humanLike', () => {
    const { lines } = stepLines({ action: 'click', selector: '#btn' });
    const code = lines.join('\n');
    expect(code).not.toContain('Bezier');
    expect(code).not.toContain('_cp1x');
  });

  test('includes fallback selectors when provided', () => {
    const { lines } = stepLines({
      action: 'click',
      selector: '#primary',
      fallbackSelectors: ['#secondary', '#tertiary'],
    });
    const code = lines.join('\n');
    expect(code).toContain('#primary');
    expect(code).toContain('#secondary');
    expect(code).toContain('#tertiary');
  });
});

describe('translateStep — wait', () => {
  test('generates waitFor() with timeout', () => {
    const { lines } = stepLines({ action: 'wait', selector: '.results', timeout: 5000 });
    const code = lines.join('\n');
    expect(code).toContain('page.locator');
    expect(code).toContain('.results');
    expect(code).toContain('waitFor');
    expect(code).toContain('5000');
  });

  test('uses default 10000ms timeout when not specified', () => {
    const { lines } = stepLines({ action: 'wait', selector: '.results' });
    const code = lines.join('\n');
    expect(code).toContain('10000');
  });
});

describe('translateStep — scroll', () => {
  test('generates scrollBy() + waitForTimeout()', () => {
    const { lines } = stepLines({ action: 'scroll', distance: 1000, count: 2, delay: 1500 });
    const code = lines.join('\n');
    expect(code).toContain('scrollBy(0, 1000)');
    expect(code).toContain('waitForTimeout(1500)');
    // count=2 means the scroll lines appear twice
    const scrollMatches = code.match(/scrollBy/g);
    expect(scrollMatches).toHaveLength(2);
  });

  test('uses default values when not specified', () => {
    const { lines } = stepLines({ action: 'scroll' });
    const code = lines.join('\n');
    // Default: distance 800, count 1, delay 1000
    expect(code).toContain('scrollBy(0, 800)');
    expect(code).toContain('waitForTimeout(1000)');
  });
});

describe('translateStep — fill', () => {
  test('generates locator.fill()', () => {
    const { lines } = stepLines(
      { action: 'fill', selector: '#search', param: 'query' },
      { query: 'hello world' }
    );
    const code = lines.join('\n');
    expect(code).toContain('.fill(');
    expect(code).toContain('hello world');
  });

  test('does nothing when param value is undefined', () => {
    const { lines } = stepLines(
      { action: 'fill', selector: '#search', param: 'query' },
      {}
    );
    expect(lines).toHaveLength(0);
  });
});

describe('translateStep — extract', () => {
  test('recordList with fields generates evaluateAll()', () => {
    const { lines } = stepLines({
      action: 'extract',
      selector: '.tweet',
      extractMode: 'recordList',
      fields: [
        { name: 'text', extract: 'innerText' },
        { name: 'url', subSelector: 'a', extract: 'attribute', attribute: 'href' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('evaluateAll');
    expect(code).toContain('results');
  });

  test('extract with "into" stores result in variable', () => {
    const { lines, vars } = stepLines({
      action: 'extract',
      selector: '#title',
      extractMode: 'text',
      into: 'pageTitle',
    });
    const code = lines.join('\n');
    expect(code).toContain('var pageTitle');
    expect(vars.has('pageTitle')).toBe(true);
  });

  test('text extract without "into" generates return statement', () => {
    const { lines } = stepLines({
      action: 'extract',
      selector: '#content',
      extractMode: 'text',
    });
    const code = lines.join('\n');
    expect(code).toContain('return');
    expect(code).toContain('result');
  });
});

describe('translateStep — return', () => {
  test('generates return object with variable substitution', () => {
    const lines = [];
    const vars = new Set(['isLoggedIn', 'pageTitle']);
    translateStep({
      action: 'return',
      value: {
        authenticated: 'isLoggedIn',
        url: '$url',
        title: '$title',
      },
    }, lines, vars, {});
    const code = lines.join('\n');
    expect(code).toContain('page.url()');
    expect(code).toContain('page.title()');
    expect(code).toContain('isLoggedIn');
  });

  test('generates default { success: true } when no value', () => {
    const { lines } = stepLines({ action: 'return' });
    const code = lines.join('\n');
    expect(code).toContain('success: true');
  });

  test('supports negation with ! prefix', () => {
    const lines = [];
    const vars = new Set(['isBlocked']);
    translateStep({
      action: 'return',
      value: { allowed: '!isBlocked' },
    }, lines, vars, {});
    const code = lines.join('\n');
    expect(code).toContain('!isBlocked');
  });
});

describe('translateStep — assertVisible (Phase 3)', () => {
  test('generates isVisible() call and stores in named variable', () => {
    const { lines, vars } = stepLines({
      action: 'assertVisible',
      selector: '.login-form',
      into: 'isLoginPage',
    });
    const code = lines.join('\n');
    expect(code).toContain('isVisible');
    expect(code).toContain('var isLoginPage');
    expect(vars.has('isLoginPage')).toBe(true);
  });

  test('defaults variable name to assertResult', () => {
    const { lines, vars } = stepLines({
      action: 'assertVisible',
      selector: '#content',
    });
    const code = lines.join('\n');
    expect(code).toContain('var assertResult');
    expect(vars.has('assertResult')).toBe(true);
  });

  test('uses specified timeout', () => {
    const { lines } = stepLines({
      action: 'assertVisible',
      selector: '#popup',
      timeout: 5000,
    });
    const code = lines.join('\n');
    expect(code).toContain('5000');
  });

  test('uses default 2000ms timeout when not specified', () => {
    const { lines } = stepLines({
      action: 'assertVisible',
      selector: '#popup',
    });
    const code = lines.join('\n');
    expect(code).toContain('2000');
  });
});

describe('translateStep — if (Phase 3)', () => {
  test('generates conditional branch with then steps', () => {
    const { lines } = stepLines({
      action: 'if',
      condition: 'isLoginPage',
      then: [
        { action: 'fill', selector: '#user', param: 'username' },
      ],
    }, { username: 'testuser' });
    const code = lines.join('\n');
    expect(code).toContain('if (isLoginPage)');
    expect(code).toContain('.fill(');
    expect(code).toContain('testuser');
  });

  test('generates else branch when provided', () => {
    const { lines } = stepLines({
      action: 'if',
      condition: 'isLoggedIn',
      then: [
        { action: 'navigate', url: 'https://app.com/dashboard' },
      ],
      else: [
        { action: 'navigate', url: 'https://app.com/login' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('if (isLoggedIn)');
    expect(code).toContain('} else {');
    expect(code).toContain('dashboard');
    expect(code).toContain('login');
  });

  test('supports ! prefix for negation', () => {
    const { lines } = stepLines({
      action: 'if',
      condition: '!isVisible',
      then: [{ action: 'wait', selector: '.content' }],
    });
    const code = lines.join('\n');
    expect(code).toContain('if (!isVisible)');
  });

  test('recursively translates nested steps', () => {
    const { lines } = stepLines({
      action: 'if',
      condition: 'needsScroll',
      then: [
        { action: 'scroll', distance: 500, count: 1, delay: 500 },
        { action: 'wait', selector: '.loaded' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('scrollBy(0, 500)');
    expect(code).toContain('.loaded');
  });
});

describe('translateStep — retry (Phase 3)', () => {
  test('generates for-loop with try/catch', () => {
    const { lines } = stepLines({
      action: 'retry',
      maxAttempts: 3,
      delayMs: 1000,
      steps: [
        { action: 'click', selector: '#submit' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('for (let');
    expect(code).toContain('< 3');
    expect(code).toContain('try {');
    expect(code).toContain('catch (_e)');
    expect(code).toContain('break; // success');
  });

  test('uses specified maxAttempts and delayMs', () => {
    const { lines } = stepLines({
      action: 'retry',
      maxAttempts: 5,
      delayMs: 2000,
      steps: [{ action: 'click', selector: '#btn' }],
    });
    const code = lines.join('\n');
    expect(code).toContain('< 5');
    expect(code).toContain('waitForTimeout(2000)');
  });

  test('throws on final attempt failure', () => {
    const { lines } = stepLines({
      action: 'retry',
      maxAttempts: 3,
      delayMs: 500,
      steps: [{ action: 'click', selector: '#flaky' }],
    });
    const code = lines.join('\n');
    // On the final attempt (index 2), re-throws
    expect(code).toContain('=== 2) throw _e');
  });

  test('recursively translates nested steps', () => {
    const { lines } = stepLines({
      action: 'retry',
      maxAttempts: 2,
      delayMs: 300,
      steps: [
        { action: 'wait', selector: '.spinner-gone', timeout: 3000 },
        { action: 'click', selector: '#action' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('.spinner-gone');
    expect(code).toContain('#action');
  });

  test('uses default maxAttempts=3 and delayMs=1000 when not specified', () => {
    const { lines } = stepLines({
      action: 'retry',
      steps: [{ action: 'click', selector: '#btn' }],
    });
    const code = lines.join('\n');
    expect(code).toContain('< 3');
    expect(code).toContain('waitForTimeout(1000)');
  });
});

describe('translateStep — nested if inside retry', () => {
  test('generates correctly nested code', () => {
    const { lines } = stepLines({
      action: 'retry',
      maxAttempts: 2,
      delayMs: 500,
      steps: [
        {
          action: 'assertVisible',
          selector: '.popup',
          into: 'hasPopup',
        },
        {
          action: 'if',
          condition: 'hasPopup',
          then: [
            { action: 'click', selector: '.dismiss' },
          ],
        },
        { action: 'click', selector: '#main-action' },
      ],
    });
    const code = lines.join('\n');
    expect(code).toContain('var hasPopup');
    expect(code).toContain('if (hasPopup)');
    expect(code).toContain('.dismiss');
    expect(code).toContain('#main-action');
    expect(code).toContain('for (let');
  });
});

describe('translateWorkflow', () => {
  test('produces valid async function string', () => {
    const code = translateWorkflow({
      execution: {
        type: 'workflow',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'wait', selector: '.loaded' },
        ],
      },
    }, {});
    expect(code).toMatch(/^async \(page\) => \{/);
    expect(code).toContain('page.goto(');
  });

  test('adds default return { success: true } when no explicit return step', () => {
    const code = translateWorkflow({
      execution: {
        type: 'workflow',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
        ],
      },
    }, {});
    expect(code).toContain('success: true');
  });

  test('does NOT add default return when explicit return step present', () => {
    const code = translateWorkflow({
      execution: {
        type: 'workflow',
        steps: [
          { action: 'navigate', url: 'https://example.com' },
          { action: 'return', value: { done: 'true' } },
        ],
      },
    }, {});
    // Should have only one return statement (from the explicit return step)
    const returnMatches = code.match(/return \{/g);
    expect(returnMatches).toHaveLength(1);
  });

  test('full workflow with multiple step types produces valid function', () => {
    const code = translateWorkflow({
      execution: {
        type: 'workflow',
        steps: [
          { action: 'navigate', urlTemplate: 'https://example.com/{query}' },
          { action: 'waitForLoadState', state: 'networkidle' },
          { action: 'wait', selector: '.results', timeout: 10000 },
          { action: 'scroll', distance: 1000, count: 2, delay: 1500 },
          {
            action: 'extract',
            selector: '.item',
            extractMode: 'recordList',
            fields: [
              { name: 'text', extract: 'innerText' },
              { name: 'url', subSelector: 'a', extract: 'attribute', attribute: 'href' },
            ],
          },
        ],
      },
    }, { query: 'test' });

    expect(code).toMatch(/^async \(page\) => \{/);
    expect(code).toContain('page.goto(');
    expect(code).toContain('waitForLoadState');
    expect(code).toContain('scrollBy');
    expect(code).toContain('evaluateAll');
  });
});

describe('translateAction', () => {
  test('single-page tool with fields generates fill code', () => {
    const code = translateAction({
      execution: {
        fields: [
          { selector: '#search', param: 'query' },
        ],
      },
    }, { query: 'test' });
    expect(code).toContain('.fill(');
    expect(code).toContain('test');
  });

  test('tool with submit generates click code', () => {
    const code = translateAction({
      execution: {
        submit: { selector: '#go' },
      },
    }, {});
    expect(code).toContain('.click()');
  });

  test('tool with submit.key generates keyboard press', () => {
    const code = translateAction({
      execution: {
        submit: { key: 'Enter' },
      },
    }, {});
    expect(code).toContain('keyboard.press');
    expect(code).toContain('Enter');
  });

  test('tool with resultSelector generates extraction code', () => {
    const code = translateAction({
      execution: {
        resultSelector: '.result',
        resultType: 'text',
      },
    }, {});
    expect(code).toContain('result');
    expect(code).toContain('return');
  });

  test('extraction mode text returns textContent', () => {
    const code = translateAction({
      execution: {
        resultSelector: '#output',
        resultExtract: 'text',
      },
    }, {});
    expect(code).toContain('textContent');
  });

  test('extraction mode list returns array of elements', () => {
    const code = translateAction({
      execution: {
        resultSelector: '.item',
        resultExtract: 'list',
      },
    }, {});
    expect(code).toContain('results');
  });

  test('extraction mode innerText uses innerText property', () => {
    const code = translateAction({
      execution: {
        resultSelector: '#content',
        resultExtract: 'innerText',
      },
    }, {});
    expect(code).toContain('innerText');
  });

  test('extraction mode html returns innerHTML', () => {
    const code = translateAction({
      execution: {
        resultSelector: '#content',
        resultExtract: 'html',
      },
    }, {});
    expect(code).toContain('innerHTML');
  });

  test('extraction mode attribute returns getAttribute', () => {
    const code = translateAction({
      execution: {
        resultSelector: '.link',
        resultExtract: 'attribute',
        resultAttribute: 'href',
      },
    }, {});
    expect(code).toContain('getAttribute');
    expect(code).toContain('href');
  });

  test('extraction mode table extracts th/td structure', () => {
    const code = translateAction({
      execution: {
        resultSelector: 'table.data',
        resultExtract: 'table',
      },
    }, {});
    expect(code).toContain('querySelectorAll');
    expect(code).toContain('th');
    expect(code).toContain('td');
  });

  test('returns { success: true } when no resultSelector', () => {
    const code = translateAction({
      execution: {},
    }, {});
    expect(code).toContain('success: true');
  });

  test('starts with async (page) => {', () => {
    const code = translateAction({ execution: {} }, {});
    expect(code).toMatch(/^async \(page\) => \{/);
  });
});
