'use strict';

const { resolveDelays, hasDelays, generateDelayCode, generateScrollCode } = require('./browser/anti-detection');

// --- Playwright selector detection ---

/**
 * Check if a selector uses Playwright-specific syntax that won't work
 * with document.querySelector(). These must use page.locator() instead.
 */
const PW_SELECTOR_RE = /:has-text\(|:text\(|:text-is\(|:text-matches\(|>> |:visible|:nth-match\(|^role=|^text=|^css=|^xpath=/;

function isPlaywrightSelector(sel) {
  if (typeof sel !== 'string') return false;
  return PW_SELECTOR_RE.test(sel);
}

/**
 * Returns true for field types that require native Playwright .fill() to work correctly.
 * DOM value manipulation (page.evaluate) breaks React and other framework-controlled inputs
 * because it bypasses their synthetic event systems.
 */
function isNativeFillType(type) {
  return !type || type === 'fill' || type === 'text' || type === 'textarea' || type === 'number' || type === 'date';
}

// --- Shadow DOM helpers (minified for injection into page.evaluate()) ---

const DEEP_QUERY_FNS = 'function deepQuery(sel,root=document){const el=root.querySelector(sel);if(el)return el;for(const h of root.querySelectorAll(\'*\')){if(h.shadowRoot){const f=deepQuery(sel,h.shadowRoot);if(f)return f;}}return null;}function deepQueryAll(sel,root=document){const r=[...root.querySelectorAll(sel)];for(const h of root.querySelectorAll(\'*\')){if(h.shadowRoot)r.push(...deepQueryAll(sel,h.shadowRoot));}return r;}';

// Legacy multi-line version (kept for backward compatibility with tests)
const SHADOW_DOM_HELPERS = `
function deepQuery(root, selector) {
  const result = root.querySelector(selector);
  if (result) return result;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

function deepQueryAll(root, selector) {
  const results = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results.push(...deepQueryAll(el.shadowRoot, selector));
    }
  }
  return results;
}
`;

// --- Selector utilities ---

// Convert a selector spec into a Playwright locator expression string
function selectorToLocator(sel) {
  if (typeof sel === 'string') {
    return `page.locator(${JSON.stringify(sel)})`;
  }
  if (sel.role) {
    const opts = {};
    if (sel.name) opts.name = sel.name;
    const optsStr = Object.keys(opts).length > 0 ? `, ${JSON.stringify(opts)}` : '';
    let locator = `page.getByRole(${JSON.stringify(sel.role)}${optsStr})`;
    if (sel.hasText) {
      locator += `.filter({ hasText: ${JSON.stringify(sel.hasText)} })`;
    }
    if (sel.nth !== undefined) {
      locator += `.nth(${sel.nth})`;
    }
    return locator;
  }
  if (sel.testId) {
    return `page.getByTestId(${JSON.stringify(sel.testId)})`;
  }
  if (sel.label) {
    return `page.getByLabel(${JSON.stringify(sel.label)})`;
  }
  if (sel.placeholder) {
    return `page.getByPlaceholder(${JSON.stringify(sel.placeholder)})`;
  }
  if (sel.text) {
    return `page.getByText(${JSON.stringify(sel.text)})`;
  }
  if (sel.css) {
    let locator = `page.locator(${JSON.stringify(sel.css)})`;
    if (sel.hasText) {
      locator += `.filter({ hasText: ${JSON.stringify(sel.hasText)} })`;
    }
    if (sel.nth !== undefined) {
      locator += `.nth(${sel.nth})`;
    }
    return locator;
  }
  // Fallback
  return `page.locator("body")`;
}

// Get the CSS selector string from a selector spec (for use in evaluate)
function selectorToCss(sel) {
  if (typeof sel === 'string') {
    // Only return CSS for pure CSS selectors, not Playwright-specific ones
    if (isPlaywrightSelector(sel)) return null;
    return sel;
  }
  if (sel.css) {
    if (isPlaywrightSelector(sel.css)) return null;
    return sel.css;
  }
  return null;
}

// Resolve the param name from a field (supports both "param" and "name" alias)
function resolveFieldParam(field) {
  return field.param || field.name;
}

// --- String utilities ---

// Quote a string for Playwright-level code (backtick template literals)
function quote(str) {
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return '`' + escaped + '`';
}

// Quote for page.evaluate() (JSON double-quoted strings)
function qs(str) {
  return JSON.stringify(str);
}

// --- DOM field action generators (for page.evaluate batching) ---

/**
 * Generate raw DOM JavaScript lines for filling a single field (CSS selectors only).
 * Returns an array of code lines for page.evaluate() body.
 */
function domFieldAction(field, value) {
  const sel = typeof field.selector === 'string' ? field.selector : field.selector.css;
  const type = field.type || 'fill';

  switch (type) {
    case 'select':
      return [
        `{ const _el = deepQuery(${qs(sel)});`,
        `  if (_el) { _el.value = ${qs(String(value))}; _el.dispatchEvent(new Event('change', { bubbles: true })); }`,
        `}`,
      ];

    case 'checkbox':
    case 'check': {
      const checked = value === true || value === 'true' || value === 'on';
      return [
        `{ const _el = deepQuery(${qs(sel)});`,
        `  if (_el) { _el.checked = ${checked}; _el.dispatchEvent(new Event('change', { bubbles: true })); }`,
        `}`,
      ];
    }

    case 'radio': {
      let radioSel = sel + `[value="${value}"]`;
      if (field.options) {
        const option = field.options.find(o => o.value === String(value));
        if (option && option.selector) radioSel = option.selector;
      }
      return [
        `{ const _el = deepQuery(${qs(radioSel)});`,
        `  if (_el) { _el.checked = true; _el.dispatchEvent(new Event('change', { bubbles: true })); }`,
        `}`,
      ];
    }

    case 'click':
      return [
        `{ const _el = deepQuery(${qs(sel)});`,
        `  if (_el) { _el.click(); }`,
        `}`,
      ];

    default: // fill, text, textarea, number, date
      return [
        `{ const _el = deepQuery(${qs(sel)});`,
        `  if (_el) { _el.focus(); _el.value = ${qs(String(value))}; _el.dispatchEvent(new Event('input', { bubbles: true })); _el.dispatchEvent(new Event('change', { bubbles: true })); }`,
        `}`,
      ];
  }
}

/**
 * Generate Playwright API lines for filling a field.
 * Returns an array of code lines (each is a standalone statement).
 */
function playwrightFieldAction(field, value, delays) {
  const locator = selectorToLocator(field.selector);
  const type = field.type || 'fill';

  switch (type) {
    case 'select':
      return [`  await ${locator}.first().selectOption(${qs(String(value))});`];

    case 'checkbox':
    case 'check':
      if (value === true || value === 'true' || value === 'on') {
        return [`  await ${locator}.first().check();`];
      }
      return [`  await ${locator}.first().uncheck();`];

    case 'radio': {
      let sel = field.selector;
      if (typeof sel === 'string') {
        sel = sel + `[value="${value}"]`;
      }
      if (field.options) {
        const option = field.options.find(o => o.value === String(value));
        if (option && option.selector) sel = option.selector;
      }
      return [`  await ${selectorToLocator(sel)}.first().click();`];
    }

    case 'click':
      return [`  await ${locator}.first().click();`];

    default: // fill, text, textarea, number, date
      if (delays && delays.typing > 0) {
        return [`  await ${locator}.first().pressSequentially(${qs(String(value))}, { delay: ${delays.typing} });`];
      }
      return [`  await ${locator}.first().fill(${qs(String(value))});`];
  }
}

// --- Extraction generators ---

/**
 * Determine the effective extraction mode from execution metadata.
 * resultExtract takes precedence over resultType when both are set.
 */
function getExtractMode(exec) {
  if (exec.resultExtract) return exec.resultExtract;
  // Map Ami's resultType to extraction mode
  if (exec.resultType === 'list') return 'list';
  return 'text';
}

/**
 * Add extraction code for CSS selectors (via page.evaluate — single CDP round-trip).
 */
function addDomExtraction(lines, selector, extractMode, attribute, extractAttributes) {
  switch (extractMode) {
    case 'list':
      if (extractAttributes && extractAttributes.length > 0) {
        const attrExtract = extractAttributes.map(a => `${a}: el.getAttribute(${qs(a)})`).join(', ');
        lines.push(`  const results = await page.evaluate((sel) => {`);
        lines.push(`    ${DEEP_QUERY_FNS}`);
        lines.push(`    return deepQueryAll(sel).map(el => ({ ${attrExtract}, text: el.textContent?.trim() }));`);
        lines.push(`  }, ${qs(selector)});`);
      } else {
        lines.push(`  { const _r = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQueryAll(sel).map(e => e.textContent?.trim()); }, ${qs(selector)});`);
        lines.push(`    if (_r.length > 0) return { results: _r };`);
        lines.push(`    return { results: ['[resultSelector matched no elements]'] }; }`);
      }
      break;

    case 'innerTextList':
      lines.push(`  const results = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQueryAll(sel).map(e => e.innerText); }, ${qs(selector)});`);
      lines.push(`  return { results };`);
      break;

    case 'html':
      lines.push(`  const result = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.innerHTML || ''; }, ${qs(selector)});`);
      lines.push(`  return { result };`);
      break;

    case 'attribute':
      lines.push(`  const result = await page.evaluate((sel, attr) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.getAttribute(attr) || ''; }, ${qs(selector)}, ${qs(attribute || 'href')});`);
      lines.push(`  return { result };`);
      break;

    case 'table':
      lines.push(`  const results = await page.evaluate((sel) => {`);
      lines.push(`    ${DEEP_QUERY_FNS}`);
      lines.push(`    const _tbl = deepQuery(sel);`);
      lines.push(`    if (!_tbl) return [];`);
      lines.push(`    const _headers = [..._tbl.querySelectorAll('th')].map(th => th.textContent.trim());`);
      lines.push(`    return [..._tbl.querySelectorAll('tr')].slice(1).map(row => {`);
      lines.push(`      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());`);
      lines.push(`      return Object.fromEntries(_headers.map((h, i) => [h, cells[i] || '']));`);
      lines.push(`    });`);
      lines.push(`  }, ${qs(selector)});`);
      lines.push(`  return { results };`);
      break;

    case 'innerText':
      lines.push(`  const result = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.innerText || ''; }, ${qs(selector)});`);
      lines.push(`  return { result };`);
      break;

    case 'text':
    default:
      lines.push(`  const result = await page.evaluate((sel) => {`);
      lines.push(`    ${DEEP_QUERY_FNS}`);
      lines.push(`    const el = deepQuery(sel);`);
      lines.push(`    return el ? el.textContent?.trim() : null;`);
      lines.push(`  }, ${qs(selector)});`);
      lines.push(`  return { result };`);
      break;
  }
}

/**
 * Add extraction code for Playwright-specific selectors (via page.locator).
 */
function addPlaywrightExtraction(lines, locatorExpr, extractMode, attribute, extractAttributes) {
  switch (extractMode) {
    case 'list':
      if (extractAttributes && extractAttributes.length > 0) {
        lines.push(`  const results = await ${locatorExpr}.evaluateAll((els, attrs) => els.map(el => {`);
        lines.push(`    const obj = { text: el.textContent?.trim() };`);
        lines.push(`    for (const a of attrs) obj[a] = el.getAttribute(a);`);
        lines.push(`    return obj;`);
        lines.push(`  }), ${JSON.stringify(extractAttributes)});`);
      } else {
        lines.push(`  { const _r = await ${locatorExpr}.allTextContents();`);
        lines.push(`    if (_r.length > 0) return { results: _r.map(t => t?.trim()) };`);
        lines.push(`    return { results: ['[resultSelector matched no elements]'] }; }`);
      }
      break;

    case 'innerTextList':
      lines.push(`  const results = await ${locatorExpr}.evaluateAll(els => els.map(e => e.innerText));`);
      lines.push(`  return { results };`);
      break;

    case 'html':
      lines.push(`  const result = await ${locatorExpr}.first().innerHTML();`);
      lines.push(`  return { result };`);
      break;

    case 'attribute':
      lines.push(`  const result = await ${locatorExpr}.first().getAttribute(${qs(attribute || 'href')});`);
      lines.push(`  return { result };`);
      break;

    case 'table':
      lines.push(`  const results = await ${locatorExpr}.first().evaluate(table => {`);
      lines.push(`    const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim());`);
      lines.push(`    return [...table.querySelectorAll('tr')].slice(1).map(row => {`);
      lines.push(`      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());`);
      lines.push(`      return Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));`);
      lines.push(`    });`);
      lines.push(`  });`);
      lines.push(`  return { results };`);
      break;

    case 'innerText':
      lines.push(`  const result = await ${locatorExpr}.first().innerText();`);
      lines.push(`  return { result };`);
      break;

    case 'text':
    default:
      lines.push(`  { const _r = await ${locatorExpr}.first().textContent().catch(() => null);`);
      lines.push(`    return { result: _r?.trim() || null }; }`);
      break;
  }
}

// --- Main translation entry point ---

function translateAction(action, args) {
  const exec = action.execution;
  const lines = [];
  const batch = []; // Accumulate CSS DOM operations for batching

  // Resolve anti-detection delays
  const delays = resolveDelays(exec.delays);
  const useDelays = hasDelays(delays);

  // Inject delay helper if needed
  if (useDelays) {
    const delayCode = generateDelayCode(delays);
    if (delayCode) lines.push(delayCode);
  }

  // Build a map of afterField scrolls for quick lookup
  const afterFieldScrolls = {};
  if (exec.scrolls) {
    for (const scroll of exec.scrolls) {
      if (scroll.afterField) {
        afterFieldScrolls[scroll.afterField] = scroll;
      }
    }
  }

  function flushBatch() {
    if (batch.length > 0) {
      lines.push(`  await page.evaluate(() => {`);
      lines.push(`    ${DEEP_QUERY_FNS}`);
      for (const line of batch) {
        lines.push(`    ${line}`);
      }
      lines.push(`  });`);
      batch.length = 0;
    }
  }

  // Phase 1: Fill fields
  for (const field of exec.fields || []) {
    const paramName = resolveFieldParam(field);
    const value = paramName ? args[paramName] : undefined;
    const resolved = value !== undefined ? value : field.defaultValue;
    if (resolved === undefined || resolved === null) continue;

    // Before-action delay
    if (useDelays && delays.beforeAction > 0) {
      flushBatch();
      lines.push(`  await _delay(${delays.beforeAction});`);
    }

    const cssSel = selectorToCss(field.selector);
    const needsPlaywright = !cssSel || isNativeFillType(field.type);

    if (needsPlaywright) {
      // Flush any pending batch before Playwright operations
      flushBatch();
      lines.push(...playwrightFieldAction(field, resolved, delays));
    } else {
      // Accumulate into batch
      batch.push(...domFieldAction(field, resolved));
    }

    // After-action delay
    if (useDelays && delays.afterAction > 0) {
      flushBatch();
      lines.push(`  await _delay(${delays.afterAction});`);
    }

    // After-field scroll
    const fieldName = paramName || field.name || field.param;
    if (fieldName && afterFieldScrolls[fieldName]) {
      flushBatch();
      const scrollCode = generateScrollCode(afterFieldScrolls[fieldName], delays);
      if (scrollCode) lines.push(scrollCode);
    }
  }

  // Phase 1b: Submit
  if (exec.submit) {
    flushBatch();
    if (exec.submit.key) {
      lines.push(`  await page.keyboard.press(${qs(exec.submit.key)});`);
    } else if (exec.submit.selector) {
      const submitLocator = selectorToLocator(exec.submit.selector);
      lines.push(`  await ${submitLocator}.first().click();`);
    }
  } else if (exec.autosubmit) {
    // Alternative autosubmit style
    if (exec.submitAction === 'click' || exec.submitAction !== 'enter') {
      const submitSel = exec.submitSelector || `${exec.selector || 'form'} [type="submit"], ${exec.selector || 'form'} button`;
      flushBatch();
      lines.push(`  await page.locator(${qs(submitSel)}).first().click();`);
    } else {
      // Enter key on last field
      const lastField = exec.fields && exec.fields.length > 0
        ? exec.fields[exec.fields.length - 1]
        : null;
      const sel = lastField ? lastField.selector : exec.selector;

      if (sel && typeof sel === 'string' && isPlaywrightSelector(sel)) {
        flushBatch();
        lines.push(`  await page.locator(${quote(sel)}).press('Enter');`);
      } else if (sel) {
        const cssSel = selectorToCss(sel);
        if (cssSel) {
          batch.push(
            `{ const _el = deepQuery(${qs(cssSel)});`,
            `  if (_el) {`,
            `    _el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));`,
            `    _el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));`,
            `    _el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));`,
            `    const _form = _el.closest('form');`,
            `    if (_form) { _form.requestSubmit ? _form.requestSubmit() : _form.submit(); }`,
            `  }`,
            `}`,
          );
        } else {
          flushBatch();
          lines.push(`  await ${selectorToLocator(sel)}.press('Enter');`);
        }
      }
    }
  }

  // Flush any remaining batch
  flushBatch();

  // After-submit scrolls
  if (exec.scrolls) {
    for (const scroll of exec.scrolls) {
      if (scroll.afterSubmit) {
        const scrollCode = generateScrollCode(scroll, delays);
        if (scrollCode) lines.push(scrollCode);
      }
    }
  }

  // Phase 2: Wait for results
  if (exec.resultDelay) {
    lines.push(`  await new Promise(r => setTimeout(r, ${exec.resultDelay}));`);
  }

  if (exec.waitFor) {
    const waitLocator = selectorToLocator(exec.waitFor);
    const timeout = exec.waitTimeout || 10000;
    if (exec.resultRequired) {
      lines.push(`  await ${waitLocator}.first().waitFor({ state: 'visible', timeout: ${timeout} });`);
    } else {
      lines.push(`  await ${waitLocator}.first().waitFor({ state: 'visible', timeout: ${timeout} }).catch(() => {});`);
    }
  }

  if (exec.resultWaitSelector) {
    if (exec.resultRequired) {
      lines.push(`  await page.waitForSelector(${qs(exec.resultWaitSelector)}, { timeout: 5000 });`);
    } else {
      lines.push(`  await page.waitForSelector(${qs(exec.resultWaitSelector)}, { timeout: 5000 }).catch(() => {});`);
    }
  }

  // Phase 3: Extract results
  if (exec.resultSelector) {
    const cssSel = selectorToCss(exec.resultSelector);
    const extractMode = getExtractMode(exec);

    if (cssSel) {
      addDomExtraction(lines, cssSel, extractMode, exec.resultAttribute, exec.extractAttributes);
    } else {
      const locatorExpr = selectorToLocator(exec.resultSelector);
      addPlaywrightExtraction(lines, locatorExpr, extractMode, exec.resultAttribute, exec.extractAttributes);
    }
  } else {
    lines.push(`  return { success: true };`);
  }

  // Phase 4: Verify selector (post-execution check)
  if (exec.verifySelector) {
    // Insert verify before the final return — wrap the extraction result
    const lastReturnIdx = lines.length - 1;
    const lastLine = lines[lastReturnIdx];
    if (lastLine && lastLine.trim().startsWith('return ')) {
      // Replace final return with a verification block
      lines.splice(lastReturnIdx, 1,
        `  const _verifyEl = await page.locator(${qs(exec.verifySelector)}).first().isVisible().catch(() => false);`,
        `  if (!_verifyEl) return { error: 'Verification failed: element not found', selector: ${qs(exec.verifySelector)} };`,
        lastLine
      );
    } else {
      lines.push(`  const _verifyEl = await page.locator(${qs(exec.verifySelector)}).first().isVisible().catch(() => false);`);
      lines.push(`  if (!_verifyEl) return { error: 'Verification failed: element not found', selector: ${qs(exec.verifySelector)} };`);
    }
  }

  return `async (page) => {\n${lines.join('\n')}\n}`;
}

module.exports = {
  translateAction,
  selectorToLocator,
  selectorToCss,
  isPlaywrightSelector,
  isNativeFillType,
  resolveFieldParam,
  SHADOW_DOM_HELPERS,
  DEEP_QUERY_FNS,
};
