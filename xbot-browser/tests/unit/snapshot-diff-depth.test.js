'use strict';

const { limitDepth, diffSnapshot } = require('../../src/browser/snapshot-filter');

describe('limitDepth', () => {
  const snapshot = [
    '- main',
    '  - navigation',
    '    - link "Home" [ref=e1]',
    '    - link "About" [ref=e2]',
    '  - form',
    '    - textbox [ref=e3]',
    '      - paragraph "Placeholder"',
    '    - button "Submit" [ref=e4]',
  ].join('\n');

  test('returns unchanged when maxDepth is null', () => {
    expect(limitDepth(snapshot, null)).toBe(snapshot);
  });

  test('returns unchanged when maxDepth is negative', () => {
    expect(limitDepth(snapshot, -1)).toBe(snapshot);
  });

  test('depth 0 keeps only top-level elements', () => {
    const result = limitDepth(snapshot, 0);
    expect(result).toContain('- main');
    expect(result).not.toContain('navigation');
    expect(result).not.toContain('link');
    expect(result).toContain('deeper elements omitted');
  });

  test('depth 1 keeps main and its direct children', () => {
    const result = limitDepth(snapshot, 1);
    expect(result).toContain('- main');
    expect(result).toContain('navigation');
    expect(result).toContain('form');
    expect(result).not.toContain('link');
    expect(result).not.toContain('textbox');
    expect(result).toContain('deeper elements omitted');
  });

  test('depth 2 keeps three levels', () => {
    const result = limitDepth(snapshot, 2);
    expect(result).toContain('link "Home"');
    expect(result).toContain('textbox');
    expect(result).toContain('button "Submit"');
    expect(result).not.toContain('paragraph');
    expect(result).toContain('1 deeper elements omitted');
  });

  test('depth beyond tree depth keeps everything', () => {
    const result = limitDepth(snapshot, 10);
    expect(result).toContain('paragraph');
    expect(result).not.toContain('omitted');
  });

  test('preserves non-ARIA lines (markdown metadata)', () => {
    const withMeta = '### Snapshot\n' + snapshot;
    const result = limitDepth(withMeta, 0);
    expect(result).toContain('### Snapshot');
    expect(result).toContain('- main');
  });

  test('empty input returns empty', () => {
    expect(limitDepth('', 2)).toBe('');
  });

  test('large snapshot (20+ lines) with various depths', () => {
    const lines = [
      '- main',
      '  - navigation',
      '    - link "Home" [ref=e1]',
      '    - link "About" [ref=e2]',
      '    - link "Contact" [ref=e3]',
      '    - link "Blog" [ref=e4]',
      '  - banner',
      '    - heading "Welcome"',
      '      - text "Hello World"',
      '  - form',
      '    - textbox "Name" [ref=e5]',
      '    - textbox "Email" [ref=e6]',
      '    - combobox "Country" [ref=e7]',
      '      - option "US"',
      '      - option "UK"',
      '      - option "CA"',
      '    - checkbox "Terms" [ref=e8]',
      '    - button "Submit" [ref=e9]',
      '  - contentinfo',
      '    - link "Privacy" [ref=e10]',
      '    - link "Terms" [ref=e11]',
      '    - paragraph "Copyright 2024"',
    ];
    const snap = lines.join('\n');

    const d0 = limitDepth(snap, 0);
    expect(d0).toContain('- main');
    expect(d0).not.toContain('navigation');
    expect(d0).toContain('21 deeper elements omitted');

    const d1 = limitDepth(snap, 1);
    expect(d1).toContain('navigation');
    expect(d1).toContain('banner');
    expect(d1).toContain('form');
    expect(d1).toContain('contentinfo');
    expect(d1).not.toContain('link "Home"');
    expect(d1).not.toContain('textbox');

    const d2 = limitDepth(snap, 2);
    expect(d2).toContain('link "Home"');
    expect(d2).toContain('textbox "Name"');
    expect(d2).toContain('button "Submit"');
    expect(d2).not.toContain('option "US"');
    expect(d2).not.toContain('text "Hello World"');
  });

  test('snapshot with inconsistent indentation (odd spaces)', () => {
    // parseLine uses indent / 2, so odd-space indentation yields fractional depth
    // Math.floor(1/2) = 0, Math.floor(3/2) = 1
    const lines = [
      '- main',
      ' - oddChild',
      '   - deeperOdd',
    ];
    const snap = lines.join('\n');

    const d0 = limitDepth(snap, 0);
    // indent 0 => depth 0, indent 1 => depth 0, indent 3 => depth 1
    expect(d0).toContain('- main');
    expect(d0).toContain('oddChild'); // depth floor(1/2) = 0, kept
    expect(d0).not.toContain('deeperOdd'); // depth floor(3/2) = 1, cut
  });

  test('mixed content: ARIA lines + plain text lines + empty lines', () => {
    const snap = [
      '### Page Snapshot',
      '',
      '- main',
      '  - button "Click" [ref=e1]',
      '',
      'Some random text',
      '  - link "More" [ref=e2]',
    ].join('\n');

    const d0 = limitDepth(snap, 0);
    // Non-ARIA lines pass through unchanged
    expect(d0).toContain('### Page Snapshot');
    expect(d0).toContain('Some random text');
    expect(d0).toContain('- main');
    // ARIA lines deeper than 0 are cut
    expect(d0).not.toContain('button "Click"');
  });

  test('all lines at same depth', () => {
    const snap = [
      '- button "A" [ref=e1]',
      '- button "B" [ref=e2]',
      '- button "C" [ref=e3]',
    ].join('\n');

    // All at depth 0, so depth 0 keeps everything
    const d0 = limitDepth(snap, 0);
    expect(d0).toContain('button "A"');
    expect(d0).toContain('button "B"');
    expect(d0).toContain('button "C"');
    expect(d0).not.toContain('omitted');
  });

  test('single line snapshot', () => {
    const snap = '- button "Solo" [ref=e1]';
    expect(limitDepth(snap, 0)).toContain('button "Solo"');
    expect(limitDepth(snap, 0)).not.toContain('omitted');
    expect(limitDepth(snap, 5)).toContain('button "Solo"');
  });

  test('depth 0 with deeply nested tree only keeps root', () => {
    const lines = [
      '- main',
      '  - section',
      '    - div',
      '      - span',
      '        - link "Deep" [ref=e1]',
      '          - text "Very deep"',
      '            - emphasis "Deepest"',
    ];
    const snap = lines.join('\n');
    const d0 = limitDepth(snap, 0);

    expect(d0).toContain('- main');
    expect(d0).not.toContain('section');
    expect(d0).not.toContain('div');
    expect(d0).not.toContain('Deep');
    expect(d0).toContain('6 deeper elements omitted');
  });
});

describe('diffSnapshot', () => {
  test('first snapshot returns full content with message', () => {
    const result = diffSnapshot(null, '- main\n  - button "Click"');
    expect(result).toContain('First snapshot');
    expect(result).toContain('- main');
    expect(result).toContain('button "Click"');
  });

  test('empty current returns empty message', () => {
    const result = diffSnapshot('- main', '');
    expect(result).toBe('[Empty snapshot]');
  });

  test('identical snapshots return no changes', () => {
    const snap = '- main\n  - button "Click" [ref=e1]';
    expect(diffSnapshot(snap, snap)).toBe('[No changes detected]');
  });

  test('detects added lines', () => {
    const prev = '- main\n  - button "Save" [ref=e1]';
    const curr = '- main\n  - button "Save" [ref=e1]\n  - button "Cancel" [ref=e2]';
    const result = diffSnapshot(prev, curr);
    expect(result).toContain('+ ');
    expect(result).toContain('button "Cancel"');
    expect(result).toContain('1 added');
  });

  test('detects removed lines', () => {
    const prev = '- main\n  - button "Save" [ref=e1]\n  - button "Cancel" [ref=e2]';
    const curr = '- main\n  - button "Save" [ref=e1]';
    const result = diffSnapshot(prev, curr);
    expect(result).toContain('- ');
    expect(result).toContain('button "Cancel"');
    expect(result).toContain('1 removed');
  });

  test('detects changed content', () => {
    const prev = '- main\n  - heading "Welcome"\n  - button "Login" [ref=e1]';
    const curr = '- main\n  - heading "Dashboard"\n  - button "Login" [ref=e1]';
    const result = diffSnapshot(prev, curr);
    expect(result).toContain('- ');
    expect(result).toContain('+ ');
    expect(result).toContain('Welcome');
    expect(result).toContain('Dashboard');
  });

  test('handles completely different snapshots', () => {
    const prev = '- navigation\n  - link "Home"';
    const curr = '- main\n  - button "Submit"';
    const result = diffSnapshot(prev, curr);
    expect(result).toContain('- ');
    expect(result).toContain('+ ');
  });

  test('summary line shows correct counts', () => {
    const prev = '- main\n  - button "A"\n  - button "B"';
    const curr = '- main\n  - button "C"\n  - button "D"\n  - button "E"';
    const result = diffSnapshot(prev, curr);
    const summary = result.split('\n')[0];
    expect(summary).toMatch(/\[\d+ added, \d+ removed\]/);
  });

  test('large diff with many additions and removals (10+ lines each)', () => {
    const prevItems = Array.from({ length: 12 }, (_, i) => `  - button "Prev${i}" [ref=e${i}]`);
    const currItems = Array.from({ length: 14 }, (_, i) => `  - button "Curr${i}" [ref=e${i + 100}]`);
    const prev = ['- main', ...prevItems].join('\n');
    const curr = ['- main', ...currItems].join('\n');

    const result = diffSnapshot(prev, curr);
    const summary = result.split('\n')[0];
    const summaryMatch = summary.match(/\[(\d+) added, (\d+) removed\]/);
    expect(summaryMatch).toBeTruthy();

    const added = parseInt(summaryMatch[1], 10);
    const removed = parseInt(summaryMatch[2], 10);
    expect(added).toBeGreaterThanOrEqual(10);
    expect(removed).toBeGreaterThanOrEqual(10);

    // Verify diff lines contain expected content markers
    expect(result).toContain('Prev0');
    expect(result).toContain('Curr0');
  });

  test('diff where lines are reordered (same content, different order)', () => {
    const prev = '- main\n  - button "A"\n  - button "B"\n  - button "C"';
    const curr = '- main\n  - button "C"\n  - button "A"\n  - button "B"';
    const result = diffSnapshot(prev, curr);

    // Should detect changes since order matters
    expect(result).not.toBe('[No changes detected]');
    expect(result).toContain('+ ');
    expect(result).toContain('- ');
  });

  test('diff with duplicate lines (same line appears multiple times)', () => {
    const prev = '- main\n  - button "X"\n  - button "X"\n  - button "Y"';
    const curr = '- main\n  - button "X"\n  - button "Y"\n  - button "X"';
    const result = diffSnapshot(prev, curr);

    // Not identical, so should show changes
    expect(result).not.toBe('[No changes detected]');
  });

  test('diff where only indentation changes (element moved in tree)', () => {
    const prev = '- main\n  - button "Click" [ref=e1]';
    const curr = '- main\n    - button "Click" [ref=e1]';
    const result = diffSnapshot(prev, curr);

    // Indentation change means different string, so diff should detect it
    expect(result).not.toBe('[No changes detected]');
    expect(result).toContain('button "Click"');
  });

  test('diff with empty lines interspersed', () => {
    const prev = '- main\n\n  - button "A"\n\n  - button "B"';
    const curr = '- main\n\n  - button "A"\n  - button "C"\n\n  - button "B"';
    const result = diffSnapshot(prev, curr);

    expect(result).toContain('button "C"');
    expect(result).toContain('+ ');
  });

  test('performance sanity: diff of 500-line snapshots completes quickly', () => {
    const makeSnap = (prefix) => {
      const lines = ['- main'];
      for (let i = 0; i < 499; i++) {
        lines.push(`  - button "${prefix}${i}" [ref=e${i}]`);
      }
      return lines.join('\n');
    };

    const prev = makeSnap('alpha');
    const curr = makeSnap('beta');

    const start = Date.now();
    const result = diffSnapshot(prev, curr);
    const elapsed = Date.now() - start;

    // Should complete within a reasonable time (5 seconds generous upper bound)
    expect(elapsed).toBeLessThan(5000);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  test('diff where previous is empty string', () => {
    const result = diffSnapshot('', '- main\n  - button "New"');
    // Empty string is falsy — treated as no previous, returns full snapshot
    expect(result).toContain('First snapshot');
    expect(result).toContain('button "New"');
  });

  test('diff preserves ARIA ref markers in output', () => {
    const prev = '- main\n  - button "Old" [ref=e1]';
    const curr = '- main\n  - button "New" [ref=e2]';
    const result = diffSnapshot(prev, curr);

    expect(result).toContain('[ref=e1]');
    expect(result).toContain('[ref=e2]');
  });
});
