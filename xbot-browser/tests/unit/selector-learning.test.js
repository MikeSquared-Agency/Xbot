'use strict';

const { generateFallbackSelectors, generateAlternativeSelector } = require('../../src/xbot-backend');

describe('generateAlternativeSelector', () => {
  test('converts #id to [id="id"]', () => {
    expect(generateAlternativeSelector('#search-box')).toBe('[id="search-box"]');
    expect(generateAlternativeSelector('#main')).toBe('[id="main"]');
    expect(generateAlternativeSelector('#my-input-123')).toBe('[id="my-input-123"]');
  });

  test('converts [data-testid="foo"] to :has-text("foo")', () => {
    expect(generateAlternativeSelector('[data-testid="submit-btn"]')).toBe(':has-text("submit btn")');
    expect(generateAlternativeSelector("[data-testid='login-form']")).toBe(':has-text("login form")');
  });

  test('converts button.class to role=button', () => {
    expect(generateAlternativeSelector('button.submit-btn')).toBe('role=button');
    expect(generateAlternativeSelector('button#go')).toBe('role=button');
    expect(generateAlternativeSelector('button')).toBe('role=button');
  });

  test('converts input.field to role=textbox', () => {
    expect(generateAlternativeSelector('input.search')).toBe('role=textbox');
    expect(generateAlternativeSelector('input#email')).toBe('role=textbox');
  });

  test('converts a.link to role=link', () => {
    expect(generateAlternativeSelector('a.nav-link')).toBe('role=link');
    expect(generateAlternativeSelector('a#home')).toBe('role=link');
  });

  test('converts select element to role=combobox', () => {
    expect(generateAlternativeSelector('select.dropdown')).toBe('role=combobox');
  });

  test('converts textarea to role=textbox', () => {
    expect(generateAlternativeSelector('textarea.message')).toBe('role=textbox');
  });

  test('converts [aria-label="search"] to :has-text("search")', () => {
    expect(generateAlternativeSelector('[aria-label="search"]')).toBe(':has-text("search")');
    expect(generateAlternativeSelector("[aria-label='Submit Form']")).toBe(':has-text("Submit Form")');
  });

  test('returns null for complex selectors with no conversion', () => {
    expect(generateAlternativeSelector('.some-class > .nested')).toBeNull();
    expect(generateAlternativeSelector('div.container .item')).toBeNull();
    expect(generateAlternativeSelector(':nth-child(2)')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(generateAlternativeSelector(null)).toBeNull();
    expect(generateAlternativeSelector(undefined)).toBeNull();
    expect(generateAlternativeSelector(42)).toBeNull();
    expect(generateAlternativeSelector({ css: '.test' })).toBeNull();
  });
});

describe('generateFallbackSelectors', () => {
  test('generates fallbacks for resultSelector', () => {
    const execution = {
      resultSelector: '#results-panel',
    };
    const fallbacks = generateFallbackSelectors(execution);
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[0]).toHaveProperty('resultSelector');
    expect(fallbacks[0].resultSelector).toBe('[id="results-panel"]');
  });

  test('generates fallbacks for field selectors', () => {
    const execution = {
      fields: [
        { selector: '#search-input', param: 'query' },
        { selector: '.filter-dropdown', param: 'filter' },
      ],
    };
    const fallbacks = generateFallbackSelectors(execution);
    // #search-input should produce a fallback
    const hasInputFallback = fallbacks.some(fb =>
      fb.fields && fb.fields.some(f => f.selector === '[id="search-input"]')
    );
    expect(hasInputFallback).toBe(true);
  });

  test('generates fallbacks for submit selector', () => {
    const execution = {
      submit: { selector: 'button.submit-btn' },
    };
    const fallbacks = generateFallbackSelectors(execution);
    const hasSubmitFallback = fallbacks.some(fb =>
      fb.submit && fb.submit.selector === 'role=button'
    );
    expect(hasSubmitFallback).toBe(true);
  });

  test('returns empty array when no selectors can be converted', () => {
    const execution = {
      resultSelector: '.complex > .nested .selector',
      fields: [
        { selector: 'div.wrapper span.text', param: 'val' },
      ],
    };
    const fallbacks = generateFallbackSelectors(execution);
    expect(fallbacks).toEqual([]);
  });

  test('returns empty array for empty execution', () => {
    expect(generateFallbackSelectors({})).toEqual([]);
  });

  test('handles execution with all selector types', () => {
    const execution = {
      resultSelector: '#output',
      fields: [
        { selector: 'input.search', param: 'q' },
        { selector: '[data-testid="filter"]', param: 'f' },
      ],
      submit: { selector: 'button.go' },
    };
    const fallbacks = generateFallbackSelectors(execution);
    // Should produce at least 4 fallback sets:
    // 1 for resultSelector, 2 for fields (input + data-testid), 1 for submit
    expect(fallbacks.length).toBeGreaterThanOrEqual(4);
  });

  test('does not generate fallback for non-string selectors', () => {
    const execution = {
      resultSelector: { css: '.item', role: 'listitem' },
      fields: [
        { selector: { testId: 'search' }, param: 'q' },
      ],
    };
    const fallbacks = generateFallbackSelectors(execution);
    expect(fallbacks).toEqual([]);
  });

  test('preserves other fields when generating field fallbacks', () => {
    const execution = {
      fields: [
        { selector: '#name', param: 'name', type: 'fill' },
        { selector: '#email', param: 'email', type: 'fill' },
      ],
    };
    const fallbacks = generateFallbackSelectors(execution);
    // Each fallback set for fields should contain all fields, with only one modified
    for (const fb of fallbacks) {
      if (fb.fields) {
        expect(fb.fields).toHaveLength(2);
      }
    }
  });
});
