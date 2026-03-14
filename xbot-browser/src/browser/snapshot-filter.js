'use strict';

// Interactive ARIA roles that should be kept in compact/interactive modes
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'option', 'treeitem',
]);

// Structural roles kept as containers (their children are kept if interactive)
const STRUCTURAL_ROLES = new Set([
  'navigation', 'main', 'dialog', 'alertdialog', 'form',
  'search', 'banner', 'contentinfo', 'complementary',
  'menu', 'menubar', 'tablist', 'toolbar', 'listbox', 'tree', 'grid',
]);

// Context roles kept in 'interactive' mode to provide labels/headings near interactive elements
const CONTEXT_ROLES = new Set([
  'heading', 'label', 'legend', 'status', 'alert',
]);

/**
 * Parse the role from an aria snapshot line.
 * Lines look like: "  - button "Submit" [ref=e12]"
 * Returns { indent, role, text, ref } or null if not parseable.
 */
function parseLine(line) {
  const match = line.match(/^(\s*)-\s+(\w+)\s*("([^"]*)")?\s*(\[ref=(e\d+)\])?/);
  if (!match) return null;
  return {
    indent: match[1].length,
    role: match[2],
    text: match[4] || '',
    ref: match[6] || null,
    raw: line,
  };
}

/**
 * Filter an aria snapshot YAML string based on mode.
 *
 * @param {string} snapshot - Raw aria snapshot YAML text
 * @param {string} mode - 'full' (no filtering), 'compact' (interactive only), 'interactive' (interactive + context)
 * @returns {string} Filtered snapshot text
 */
function filterSnapshot(snapshot, mode) {
  if (mode === 'full' || !mode) return snapshot;

  const lines = snapshot.split('\n');
  const result = [];
  const includeContext = mode === 'interactive';

  // First pass: mark which lines to keep
  const keep = new Array(lines.length).fill(false);
  const parsed = lines.map(l => parseLine(l));

  for (let i = 0; i < lines.length; i++) {
    const p = parsed[i];
    if (!p) continue;

    if (INTERACTIVE_ROLES.has(p.role)) {
      keep[i] = true;
      // Keep parent structural containers
      markParents(i, parsed, keep);
    }

    if (includeContext && CONTEXT_ROLES.has(p.role)) {
      // Keep context roles if they're near (within 3 lines of) an interactive element
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
        const neighbor = parsed[j];
        if (neighbor && INTERACTIVE_ROLES.has(neighbor.role)) {
          keep[i] = true;
          markParents(i, parsed, keep);
          break;
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) result.push(lines[i]);
  }

  return result.join('\n');
}

/**
 * Walk backwards to find and mark parent lines (lower indent) as kept.
 */
function markParents(idx, parsed, keep) {
  const child = parsed[idx];
  if (!child) return;

  let targetIndent = child.indent;
  for (let i = idx - 1; i >= 0; i--) {
    const p = parsed[i];
    if (!p) continue;
    if (p.indent < targetIndent) {
      keep[i] = true;
      targetIndent = p.indent;
      if (targetIndent === 0) break;
    }
  }
}

module.exports = { filterSnapshot, parseLine, INTERACTIVE_ROLES, STRUCTURAL_ROLES, CONTEXT_ROLES };
