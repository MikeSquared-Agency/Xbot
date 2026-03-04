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

/**
 * Store extraction result into a named variable (DOM selectors).
 * Used by workflow extract steps with `into` field.
 */
function addDomExtractionVar(lines, selector, extractMode, varName, attribute) {
  switch (extractMode) {
    case 'innerTextList':
      lines.push(`  var ${varName} = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQueryAll(sel).map(e => e.innerText); }, ${qs(selector)});`);
      break;
    case 'innerText':
      lines.push(`  var ${varName} = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.innerText || null; }, ${qs(selector)});`);
      break;
    case 'attribute':
      lines.push(`  var ${varName} = await page.evaluate((sel, attr) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.getAttribute(attr) || null; }, ${qs(selector)}, ${qs(attribute || 'href')});`);
      break;
    case 'text':
    default:
      lines.push(`  var ${varName} = await page.evaluate((sel) => { ${DEEP_QUERY_FNS} return deepQuery(sel)?.textContent?.trim() || null; }, ${qs(selector)});`);
      break;
  }
}

/**
 * Store extraction result into a named variable (Playwright selectors).
 */
function addPlaywrightExtractionVar(lines, locatorExpr, extractMode, varName, attribute) {
  switch (extractMode) {
    case 'innerTextList':
      lines.push(`  var ${varName} = await ${locatorExpr}.evaluateAll(els => els.map(e => e.innerText));`);
      break;
    case 'innerText':
      lines.push(`  var ${varName} = await ${locatorExpr}.first().innerText().catch(() => null);`);
      break;
    case 'attribute':
      lines.push(`  var ${varName} = await ${locatorExpr}.first().getAttribute(${qs(attribute || 'href')}).catch(() => null);`);
      break;
    case 'text':
    default:
      lines.push(`  var ${varName} = await ${locatorExpr}.first().textContent().catch(() => null);`);
      lines.push(`  ${varName} = ${varName}?.trim() || null;`);
      break;
  }
}

// --- Workflow translation ---

/**
 * Translate a workflow-type execution into Playwright code.
 * Workflow executions have { type: 'workflow', steps: [...] } and support
 * multi-step browser automation (navigate, click, download, extract, etc.).
 *
 * Returns an async function string: `async (page) => { ... }`
 *
 * IMPORTANT: The `download` step generates code that returns { downloadPath, filename }.
 * The caller (xbot-backend) must read the file from disk using fs since browser_run_code
 * runs in browser context where fs is NOT available — but page.waitForEvent('download')
 * and download.path() ARE available because they're Playwright API, not browser API.
 */
function translateWorkflow(action, args) {
  const exec = action.execution;
  const steps = exec.steps || [];
  const lines = [];

  // Track variables set by steps (e.g., checkUrl sets isLoginPage)
  const vars = new Set();

  for (const step of steps) {
    switch (step.action) {
      case 'navigate': {
        let url = step.url || step.urlTemplate || '';

        // Compute params (date offsets, etc.)
        if (step.computeParams) {
          for (const [paramName, spec] of Object.entries(step.computeParams)) {
            if (spec.type === 'dateOffset') {
              const fieldName = spec.field || 'days';
              const defaultVal = spec.default || 1;
              const argVal = args[fieldName] !== undefined ? args[fieldName] : defaultVal;
              // Compute date: today minus offset days
              // offset expression like "-(days-1)" means go back (days-1) days
              const offsetDays = argVal - 1;
              lines.push(`  { const _d = new Date(); _d.setDate(_d.getDate() - ${offsetDays});`);
              lines.push(`    var ${paramName} = _d.toISOString().split('T')[0]; }`);
              vars.add(paramName);
            } else if (spec.type === 'today') {
              lines.push(`  var ${paramName} = new Date().toISOString().split('T')[0];`);
              vars.add(paramName);
            }
          }
        }

        // Substitute {paramName} in URL template
        if (step.urlTemplate) {
          // Replace {param} with arg values or computed vars
          let urlExpr = JSON.stringify(step.urlTemplate);
          // Find all {param} placeholders
          const placeholders = step.urlTemplate.match(/\{(\w+)\}/g) || [];
          if (placeholders.length > 0) {
            // Build URL via template literal
            let templateUrl = step.urlTemplate;
            for (const ph of placeholders) {
              const paramName = ph.slice(1, -1);
              templateUrl = templateUrl.replace(ph, '${' + paramName + '}');
            }
            // Resolve non-computed params from args
            for (const ph of placeholders) {
              const paramName = ph.slice(1, -1);
              if (!vars.has(paramName) && args[paramName] !== undefined) {
                lines.push(`  var ${paramName} = ${JSON.stringify(String(args[paramName]))};`);
                vars.add(paramName);
              }
            }
            urlExpr = '`' + templateUrl.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
          }
          lines.push(`  await page.goto(${urlExpr});`);
        } else {
          // Simple URL with {param} substitution from args
          for (const [key, val] of Object.entries(args)) {
            url = url.replace(`{${key}}`, String(val));
          }
          lines.push(`  await page.goto(${JSON.stringify(url)});`);
        }
        break;
      }

      case 'waitForLoadState': {
        const state = step.state || 'networkidle';
        const timeout = step.timeout || 15000;
        lines.push(`  await page.waitForLoadState(${JSON.stringify(state)}, { timeout: ${timeout} }).catch(() => {});`);
        break;
      }

      case 'wait': {
        const sel = step.selector;
        const timeout = step.timeout || 10000;
        if (sel) {
          lines.push(`  await page.locator(${JSON.stringify(sel)}).first().waitFor({ state: 'visible', timeout: ${timeout} }).catch(() => {});`);
        }
        break;
      }

      case 'click': {
        const selectors = [step.selector, ...(step.fallbackSelectors || [])].filter(Boolean);
        lines.push(`  {`);
        lines.push(`    const _sels = ${JSON.stringify(selectors)};`);
        lines.push(`    let _clicked = false;`);
        lines.push(`    for (const _sel of _sels) {`);
        lines.push(`      const _loc = page.locator(_sel).first();`);
        lines.push(`      const _vis = await _loc.isVisible({ timeout: 1000 }).catch(() => false);`);
        lines.push(`      if (_vis) { await _loc.click(); _clicked = true; break; }`);
        lines.push(`    }`);
        lines.push(`    if (!_clicked) throw new Error('click: no matching selector found');`);
        lines.push(`  }`);
        break;
      }

      case 'download': {
        const selectors = [step.selector, ...(step.fallbackSelectors || [])].filter(Boolean);
        lines.push(`  {`);
        lines.push(`    const _sels = ${JSON.stringify(selectors)};`);
        lines.push(`    let _exportBtn = null;`);
        lines.push(`    for (const _sel of _sels) {`);
        lines.push(`      const _loc = page.locator(_sel).first();`);
        lines.push(`      const _vis = await _loc.isVisible({ timeout: 1000 }).catch(() => false);`);
        lines.push(`      if (_vis) { _exportBtn = _loc; break; }`);
        lines.push(`    }`);
        lines.push(`    if (!_exportBtn) throw new Error('download: could not find download button');`);
        lines.push(`    const [_dl] = await Promise.all([`);
        lines.push(`      page.waitForEvent('download', { timeout: 30000 }),`);
        lines.push(`      _exportBtn.click(),`);
        lines.push(`    ]);`);
        lines.push(`    const _dlPath = await _dl.path();`);
        lines.push(`    if (!_dlPath) throw new Error('download: no file path received');`);
        if (step.returnContent) {
          lines.push(`    return { downloadPath: _dlPath, filename: _dl.suggestedFilename() };`);
        } else {
          lines.push(`    var _downloadPath = _dlPath;`);
          lines.push(`    var _downloadFilename = _dl.suggestedFilename();`);
        }
        lines.push(`  }`);
        break;
      }

      case 'checkUrl': {
        const varName = step.resultField || 'checkResult';
        const patterns = step.patterns || [];
        const titlePatterns = step.titlePatterns || [];
        vars.add(varName);

        lines.push(`  var ${varName};`);
        lines.push(`  {`);
        lines.push(`    const _url = page.url();`);
        lines.push(`    const _title = await page.title();`);

        const urlChecks = patterns.map(p => `_url.includes(${JSON.stringify(p)})`);
        const titleChecks = titlePatterns.map(p => `_title.toLowerCase().includes(${JSON.stringify(p.toLowerCase())})`);
        const allChecks = [...urlChecks, ...titleChecks];

        lines.push(`    ${varName} = ${allChecks.join(' || ') || 'false'};`);
        lines.push(`  }`);
        break;
      }

      case 'scroll': {
        const distance = step.distance || 800;
        const count = step.count || 1;
        const delay = step.delay || 1000;
        for (let i = 0; i < count; i++) {
          lines.push(`  await page.evaluate(() => window.scrollBy(0, ${distance}));`);
          lines.push(`  await page.waitForTimeout(${delay});`);
        }
        if (step.waitForLoadState) {
          lines.push(`  await page.waitForLoadState(${JSON.stringify(step.waitForLoadState)}, { timeout: ${step.timeout || 10000} }).catch(() => {});`);
        }
        break;
      }

      case 'extract': {
        const sel = step.selector;
        const mode = step.extractMode || 'text';
        const into = step.into; // optional: store into variable instead of returning
        const cssSel = selectorToCss(sel);

        if (into) {
          // Store extraction result into a variable (no return)
          vars.add(into);
          if (cssSel) {
            addDomExtractionVar(lines, cssSel, mode, into, step.attribute);
          } else if (sel) {
            addPlaywrightExtractionVar(lines, selectorToLocator(sel), mode, into, step.attribute);
          }
        } else {
          if (cssSel) {
            addDomExtraction(lines, cssSel, mode, step.attribute, step.extractAttributes);
          } else if (sel) {
            const locatorExpr = selectorToLocator(sel);
            addPlaywrightExtraction(lines, locatorExpr, mode, step.attribute, step.extractAttributes);
          }
        }
        break;
      }

      case 'fill': {
        const sel = step.selector;
        const paramName = step.param || step.name;
        const value = paramName ? args[paramName] : step.value;
        if (value !== undefined && value !== null && sel) {
          const locator = selectorToLocator(sel);
          lines.push(`  await ${locator}.first().fill(${JSON.stringify(String(value))});`);
        }
        break;
      }

      case 'return': {
        const retVal = step.value;
        if (!retVal) {
          lines.push(`  return { success: true };`);
          break;
        }

        // Build return object with variable substitution
        // $url → page.url(), $title → page.title()
        // !varName → negation of a variable
        // varName → value of a variable
        const entries = [];
        for (const [key, expr] of Object.entries(retVal)) {
          if (expr === '$url') {
            entries.push(`${JSON.stringify(key)}: page.url()`);
          } else if (expr === '$title') {
            entries.push(`${JSON.stringify(key)}: await page.title()`);
          } else if (typeof expr === 'string' && expr.startsWith('!')) {
            entries.push(`${JSON.stringify(key)}: !${expr.slice(1)}`);
          } else if (typeof expr === 'string' && vars.has(expr)) {
            entries.push(`${JSON.stringify(key)}: ${expr}`);
          } else {
            entries.push(`${JSON.stringify(key)}: ${JSON.stringify(expr)}`);
          }
        }
        lines.push(`  return { ${entries.join(', ')} };`);
        break;
      }

      default:
        lines.push(`  // Unknown step action: ${step.action}`);
    }
  }

  // If no explicit return step, add default
  if (!steps.some(s => s.action === 'return' || (s.action === 'download' && s.returnContent) || s.action === 'extract')) {
    lines.push(`  return { success: true };`);
  }

  return `async (page) => {\n${lines.join('\n')}\n}`;
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
  translateWorkflow,
  selectorToLocator,
  selectorToCss,
  isPlaywrightSelector,
  isNativeFillType,
  resolveFieldParam,
  SHADOW_DOM_HELPERS,
  DEEP_QUERY_FNS,
};
