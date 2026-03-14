'use strict';

const { filterSnapshot, parseLine, INTERACTIVE_ROLES, STRUCTURAL_ROLES, CONTEXT_ROLES } = require('../../src/browser/snapshot-filter');

describe('parseLine', () => {
  test('extracts indent, role, text, and ref from a standard line', () => {
    const result = parseLine('  - button "Submit" [ref=e12]');
    expect(result).toEqual({
      indent: 2,
      role: 'button',
      text: 'Submit',
      ref: 'e12',
      raw: '  - button "Submit" [ref=e12]',
    });
  });

  test('extracts role without text or ref', () => {
    const result = parseLine('- navigation');
    expect(result).toEqual({
      indent: 0,
      role: 'navigation',
      text: '',
      ref: null,
      raw: '- navigation',
    });
  });

  test('extracts role with text but no ref', () => {
    const result = parseLine('    - heading "Page Title"');
    expect(result).toEqual({
      indent: 4,
      role: 'heading',
      text: 'Page Title',
      ref: null,
      raw: '    - heading "Page Title"',
    });
  });

  test('extracts role with ref but no text', () => {
    const result = parseLine('  - textbox [ref=e37]');
    expect(result).toEqual({
      indent: 2,
      role: 'textbox',
      text: '',
      ref: 'e37',
      raw: '  - textbox [ref=e37]',
    });
  });

  test('returns null for non-parseable line', () => {
    expect(parseLine('just some text')).toBeNull();
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
  });
});

describe('filterSnapshot — mode "full"', () => {
  test('returns input unchanged', () => {
    const snapshot = [
      '- navigation',
      '  - link "Home" [ref=e1]',
      '  - paragraph "Welcome to the site"',
      '  - button "Login" [ref=e2]',
    ].join('\n');

    expect(filterSnapshot(snapshot, 'full')).toBe(snapshot);
  });

  test('returns input unchanged when mode is undefined', () => {
    const snapshot = '- paragraph "Hello"';
    expect(filterSnapshot(snapshot, undefined)).toBe(snapshot);
  });

  test('returns input unchanged when mode is null/falsy', () => {
    const snapshot = '- paragraph "Hello"';
    expect(filterSnapshot(snapshot, '')).toBe(snapshot);
    expect(filterSnapshot(snapshot, null)).toBe(snapshot);
  });
});

describe('filterSnapshot — mode "compact"', () => {
  test('keeps interactive elements (button, link, textbox)', () => {
    const snapshot = [
      '- main',
      '  - button "Submit" [ref=e1]',
      '  - link "Home" [ref=e2]',
      '  - textbox [ref=e3]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result).toContain('button "Submit"');
    expect(result).toContain('link "Home"');
    expect(result).toContain('textbox');
  });

  test('removes non-interactive elements (paragraph, img, status, heading)', () => {
    const snapshot = [
      '- main',
      '  - paragraph "Some text"',
      '  - img "Logo"',
      '  - status "Loading"',
      '  - heading "Title"',
      '  - button "Click" [ref=e1]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result).not.toContain('paragraph');
    expect(result).not.toContain('img');
    expect(result).not.toContain('status');
    expect(result).not.toContain('heading');
    expect(result).toContain('button "Click"');
  });

  test('preserves parent structural containers', () => {
    const snapshot = [
      '- navigation',
      '  - link "Home" [ref=e1]',
      '  - paragraph "Description"',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result).toContain('navigation');
    expect(result).toContain('link "Home"');
    expect(result).not.toContain('paragraph');
  });

  test('preserves deeply nested structural parents', () => {
    const snapshot = [
      '- main',
      '  - form',
      '    - navigation',
      '      - textbox [ref=e5]',
      '      - paragraph "Help text"',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result).toContain('main');
    expect(result).toContain('form');
    expect(result).toContain('navigation');
    expect(result).toContain('textbox');
    expect(result).not.toContain('paragraph');
  });

  test('preserves refs on interactive elements', () => {
    const snapshot = [
      '- main',
      '  - button "Save" [ref=e42]',
      '  - checkbox [ref=e99]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result).toContain('[ref=e42]');
    expect(result).toContain('[ref=e99]');
  });

  test('preserves indentation/nesting structure', () => {
    const snapshot = [
      '- main',
      '  - form',
      '    - textbox [ref=e1]',
      '    - button "Go" [ref=e2]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    const lines = result.split('\n');
    // main at indent 0
    expect(lines[0]).toBe('- main');
    // form at indent 2
    expect(lines[1]).toBe('  - form');
    // textbox at indent 4
    expect(lines[2]).toBe('    - textbox [ref=e1]');
  });
});

describe('filterSnapshot — mode "interactive"', () => {
  test('keeps interactive elements', () => {
    const snapshot = [
      '- main',
      '  - button "Save" [ref=e1]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'interactive');
    expect(result).toContain('button "Save"');
  });

  test('keeps nearby context roles (heading, label, status) within 3 lines of interactive', () => {
    const snapshot = [
      '- main',
      '  - heading "Login Form"',
      '  - label "Username"',
      '  - textbox [ref=e1]',
      '  - status "Ready"',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'interactive');
    expect(result).toContain('heading "Login Form"');
    expect(result).toContain('label "Username"');
    expect(result).toContain('textbox');
    expect(result).toContain('status "Ready"');
  });

  test('removes non-contextual elements far from interactive', () => {
    const snapshot = [
      '- main',
      '  - paragraph "Intro text line 1"',
      '  - paragraph "Intro text line 2"',
      '  - paragraph "Intro text line 3"',
      '  - paragraph "Intro text line 4"',
      '  - paragraph "Intro text line 5"',
      '  - heading "Far away heading"',
      '  - paragraph "More text line 1"',
      '  - paragraph "More text line 2"',
      '  - paragraph "More text line 3"',
      '  - paragraph "More text line 4"',
      '  - button "Action" [ref=e1]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'interactive');
    expect(result).toContain('button "Action"');
    // The heading at line 6 is more than 3 lines away from button at line 11
    // (index 6 vs index 11, diff = 5 > 3), so it should not be kept
    expect(result).not.toContain('Far away heading');
    // paragraphs are never kept (not in INTERACTIVE or CONTEXT roles)
    expect(result).not.toContain('paragraph');
  });

  test('keeps context role alert near interactive element', () => {
    const snapshot = [
      '- form',
      '  - alert "Error: invalid email"',
      '  - textbox [ref=e10]',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'interactive');
    expect(result).toContain('alert "Error: invalid email"');
    expect(result).toContain('textbox');
  });
});

describe('filterSnapshot — edge cases', () => {
  test('empty input returns empty string', () => {
    expect(filterSnapshot('', 'compact')).toBe('');
    expect(filterSnapshot('', 'interactive')).toBe('');
    expect(filterSnapshot('', 'full')).toBe('');
  });

  test('snapshot with only non-interactive elements returns empty for compact', () => {
    const snapshot = [
      '- paragraph "Hello"',
      '- paragraph "World"',
      '- img "Logo"',
    ].join('\n');

    const result = filterSnapshot(snapshot, 'compact');
    expect(result.trim()).toBe('');
  });

  test('all interactive roles are recognized', () => {
    const expectedRoles = [
      'button', 'link', 'textbox', 'searchbox', 'combobox',
      'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
      'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'option', 'treeitem',
    ];
    for (const role of expectedRoles) {
      expect(INTERACTIVE_ROLES.has(role)).toBe(true);
    }
  });

  test('structural roles include navigation, main, form, dialog', () => {
    expect(STRUCTURAL_ROLES.has('navigation')).toBe(true);
    expect(STRUCTURAL_ROLES.has('main')).toBe(true);
    expect(STRUCTURAL_ROLES.has('form')).toBe(true);
    expect(STRUCTURAL_ROLES.has('dialog')).toBe(true);
  });

  test('context roles include heading, label, status, alert', () => {
    expect(CONTEXT_ROLES.has('heading')).toBe(true);
    expect(CONTEXT_ROLES.has('label')).toBe(true);
    expect(CONTEXT_ROLES.has('status')).toBe(true);
    expect(CONTEXT_ROLES.has('alert')).toBe(true);
  });
});
