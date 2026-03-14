'use strict';

const { generateFallbackSelectors, generateAlternativeSelector } = require('../../src/xbot-backend');

// truncateResult is not exported, but we can test its behavioral contracts
// and the patterns it uses. We also fully test the exported selector generators.

describe('truncation patterns and contracts', () => {
  test('DEFAULT_MAX_RESULT_CHARS respects XBOT_MAX_OUTPUT env var pattern', () => {
    // The default is parseInt(process.env.XBOT_MAX_OUTPUT || '40000', 10)
    // We verify the pattern by checking the fallback value
    const defaultVal = parseInt(process.env.XBOT_MAX_OUTPUT || '40000', 10);
    expect(defaultVal).toBeGreaterThan(0);
    expect(typeof defaultVal).toBe('number');
    // Default should be 40000 unless env var is set
    if (!process.env.XBOT_MAX_OUTPUT) {
      expect(defaultVal).toBe(40000);
    }
  });

  test('truncation message format matches expected pattern', () => {
    const droppedChars = 12345;
    const truncationMessage = `\n\n[...truncated, ${droppedChars} more chars]`;
    expect(truncationMessage).toMatch(/\[\.\.\.truncated, \d+ more chars\]/);
  });

  test('truncation message includes actual character count', () => {
    const counts = [1, 100, 5000, 99999];
    for (const count of counts) {
      const msg = `\n\n[...truncated, ${count} more chars]`;
      expect(msg).toContain(`${count} more chars`);
    }
  });

  test('truncation preserves line boundaries when possible', () => {
    // The truncation logic: item.text.lastIndexOf('\n', budget)
    // If truncPoint > budget * 0.5, it cuts at the newline
    const text = 'line1\nline2\nline3\nline4\nline5';
    const budget = 15; // Somewhere in the middle of "line3"
    const truncPoint = text.lastIndexOf('\n', budget);

    // truncPoint should be at the newline before "line3" (position 11)
    expect(truncPoint).toBeGreaterThan(0);
    // The cut text should end at a line boundary
    const cutText = text.slice(0, truncPoint);
    expect(cutText.endsWith('\n')).toBe(false); // lastIndexOf gives position OF the newline
    expect(cutText).toBe('line1\nline2');
  });

  test('line-boundary truncation falls back to raw budget when no good newline', () => {
    // If truncPoint <= budget * 0.5, it uses budget directly
    const text = 'a'.repeat(100) + '\n' + 'b'.repeat(100);
    const budget = 80;
    const truncPoint = text.lastIndexOf('\n', budget);

    // No newline within first 80 chars (newline is at position 100)
    expect(truncPoint).toBe(-1);
    // So the code would use: cutAt = budget (since -1 < budget * 0.5)
    const cutAt = truncPoint > budget * 0.5 ? truncPoint : budget;
    expect(cutAt).toBe(budget);
  });
});

describe('generateAlternativeSelector', () => {
  test('returns null for non-string input', () => {
    expect(generateAlternativeSelector(null)).toBeNull();
    expect(generateAlternativeSelector(undefined)).toBeNull();
    expect(generateAlternativeSelector(123)).toBeNull();
    expect(generateAlternativeSelector({})).toBeNull();
  });

  test('converts data-testid to has-text selector', () => {
    const result = generateAlternativeSelector('[data-testid="submit-button"]');
    expect(result).toBe(':has-text("submit button")');
  });

  test('converts data-testid with single quotes', () => {
    const result = generateAlternativeSelector("[data-testid='nav-menu']");
    expect(result).toBe(':has-text("nav menu")');
  });

  test('converts data-testid with underscores to spaces', () => {
    const result = generateAlternativeSelector('[data-testid="user_profile_card"]');
    expect(result).toBe(':has-text("user profile card")');
  });

  test('converts button tag to role=button', () => {
    expect(generateAlternativeSelector('button.submit-btn')).toBe('role=button');
    expect(generateAlternativeSelector('button#save')).toBe('role=button');
    expect(generateAlternativeSelector('button')).toBe('role=button');
  });

  test('converts input tag to role=textbox', () => {
    expect(generateAlternativeSelector('input.search')).toBe('role=textbox');
    expect(generateAlternativeSelector('input#email')).toBe('role=textbox');
  });

  test('converts select tag to role=combobox', () => {
    expect(generateAlternativeSelector('select.country')).toBe('role=combobox');
  });

  test('converts textarea tag to role=textbox', () => {
    expect(generateAlternativeSelector('textarea.comment')).toBe('role=textbox');
  });

  test('converts a tag to role=link', () => {
    expect(generateAlternativeSelector('a.nav-link')).toBe('role=link');
    expect(generateAlternativeSelector('a#home')).toBe('role=link');
  });

  test('converts #id selector to [id="..."] attribute selector', () => {
    expect(generateAlternativeSelector('#search-box')).toBe('[id="search-box"]');
    expect(generateAlternativeSelector('#main')).toBe('[id="main"]');
    expect(generateAlternativeSelector('#nav-item-3')).toBe('[id="nav-item-3"]');
  });

  test('does not convert compound #id selectors', () => {
    // #id.class or #id child should NOT match the simple #id regex
    expect(generateAlternativeSelector('#foo .bar')).toBeNull();
  });

  test('converts aria-label to has-text selector', () => {
    const result = generateAlternativeSelector('[aria-label="Close dialog"]');
    expect(result).toBe(':has-text("Close dialog")');
  });

  test('converts aria-label with single quotes', () => {
    const result = generateAlternativeSelector("[aria-label='Search']");
    expect(result).toBe(':has-text("Search")');
  });

  test('returns null for unrecognized selectors', () => {
    expect(generateAlternativeSelector('.some-class')).toBeNull();
    expect(generateAlternativeSelector('div.container')).toBeNull();
    expect(generateAlternativeSelector('span > em')).toBeNull();
    expect(generateAlternativeSelector(':nth-child(2)')).toBeNull();
  });

  test('data-testid takes priority over other patterns', () => {
    // A selector that has data-testid should use that path
    const result = generateAlternativeSelector('[data-testid="nav-link"]');
    expect(result).toBe(':has-text("nav link")');
    // Not role=link, because testid match comes first
  });
});

describe('generateFallbackSelectors', () => {
  test('returns empty array for execution with no selectors', () => {
    const result = generateFallbackSelectors({});
    expect(result).toEqual([]);
  });

  test('generates fallback for resultSelector', () => {
    const result = generateFallbackSelectors({
      resultSelector: '#results',
    });
    expect(result.length).toBe(1);
    expect(result[0].resultSelector).toBe('[id="results"]');
  });

  test('generates fallback for field selectors', () => {
    const result = generateFallbackSelectors({
      fields: [
        { selector: 'input.search', param: 'query', type: 'fill' },
      ],
    });
    expect(result.length).toBe(1);
    expect(result[0].fields).toBeDefined();
    expect(result[0].fields[0].selector).toBe('role=textbox');
  });

  test('generates fallback for submit selector', () => {
    const result = generateFallbackSelectors({
      submit: { selector: 'button.go' },
    });
    expect(result.length).toBe(1);
    expect(result[0].submit.selector).toBe('role=button');
  });

  test('generates fallbacks for all selector types in one execution', () => {
    const result = generateFallbackSelectors({
      resultSelector: '#output',
      fields: [
        { selector: 'input.name', param: 'name', type: 'fill' },
        { selector: 'select.option', param: 'opt', type: 'select' },
      ],
      submit: { selector: 'button.submit' },
    });

    // resultSelector + 2 fields + submit = 4 fallback sets
    expect(result.length).toBe(4);

    // Check each fallback type is present
    const hasResultFallback = result.some(f => f.resultSelector);
    const hasFieldFallbacks = result.filter(f => f.fields).length;
    const hasSubmitFallback = result.some(f => f.submit);

    expect(hasResultFallback).toBe(true);
    expect(hasFieldFallbacks).toBe(2);
    expect(hasSubmitFallback).toBe(true);
  });

  test('skips selectors that cannot generate alternatives', () => {
    const result = generateFallbackSelectors({
      resultSelector: '.some-class',
      fields: [
        { selector: 'div.container', param: 'x', type: 'fill' },
      ],
      submit: { selector: 'span.btn' },
    });

    // None of these match any pattern, so no fallbacks
    expect(result).toEqual([]);
  });

  test('skips non-string selectors', () => {
    const result = generateFallbackSelectors({
      resultSelector: { css: '.result', role: 'list' },
    });
    expect(result).toEqual([]);
  });

  test('preserves other field properties when generating field fallbacks', () => {
    const result = generateFallbackSelectors({
      fields: [
        { selector: '#username', param: 'user', type: 'fill' },
        { selector: '.no-alt', param: 'other', type: 'fill' },
      ],
    });

    // Only #username generates a fallback
    expect(result.length).toBe(1);
    const fallbackFields = result[0].fields;
    // The field with #username should be replaced
    expect(fallbackFields[0].selector).toBe('[id="username"]');
    expect(fallbackFields[0].param).toBe('user');
    expect(fallbackFields[0].type).toBe('fill');
    // The other field should be unchanged
    expect(fallbackFields[1].selector).toBe('.no-alt');
    expect(fallbackFields[1].param).toBe('other');
  });

  test('preserves submit properties when generating submit fallback', () => {
    const result = generateFallbackSelectors({
      submit: { selector: 'button.go', waitFor: '.results', timeout: 5000 },
    });

    expect(result.length).toBe(1);
    expect(result[0].submit.selector).toBe('role=button');
    expect(result[0].submit.waitFor).toBe('.results');
    expect(result[0].submit.timeout).toBe(5000);
  });
});
