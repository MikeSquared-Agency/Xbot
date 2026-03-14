'use strict';

const { generateHumanMouseCode, randomUserAgent } = require('./fingerprint');

const DEFAULT_DELAYS = {
  beforeAction: 0,
  afterAction: 0,
  typing: 0,
  scroll: 0,
  jitter: 0,
};

function resolveDelays(executionDelays = {}) {
  const envOverrides = {};
  if (process.env.XBOT_DELAY_BEFORE_ACTION) envOverrides.beforeAction = parseInt(process.env.XBOT_DELAY_BEFORE_ACTION, 10);
  if (process.env.XBOT_DELAY_AFTER_ACTION) envOverrides.afterAction = parseInt(process.env.XBOT_DELAY_AFTER_ACTION, 10);
  if (process.env.XBOT_DELAY_TYPING) envOverrides.typing = parseInt(process.env.XBOT_DELAY_TYPING, 10);
  if (process.env.XBOT_DELAY_SCROLL) envOverrides.scroll = parseInt(process.env.XBOT_DELAY_SCROLL, 10);
  if (process.env.XBOT_DELAY_JITTER) envOverrides.jitter = parseInt(process.env.XBOT_DELAY_JITTER, 10);

  return {
    ...DEFAULT_DELAYS,
    ...executionDelays,
    ...envOverrides,
  };
}

function hasDelays(delays) {
  return delays && (delays.beforeAction > 0 || delays.afterAction > 0 || delays.typing > 0 || delays.scroll > 0 || delays.jitter > 0);
}

function generateDelayCode(delays) {
  if (!hasDelays(delays)) return '';
  const jitter = delays.jitter || 0;
  return `  const _delay = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * ${jitter}));`;
}

function generateScrollCode(scrollConfig, delays) {
  if (!scrollConfig) return '';

  const lines = [];
  const scrollDelay = delays.scroll || 1000;

  if (scrollConfig.selector) {
    lines.push(`  {`);
    lines.push(`    const _scrollEl = await page.locator(${JSON.stringify(scrollConfig.selector)}).first().elementHandle();`);
    lines.push(`    if (_scrollEl) {`);
    lines.push(`      const _box = await _scrollEl.boundingBox();`);
    lines.push(`      if (_box) {`);
    lines.push(`        await page.mouse.move(_box.x + _box.width / 2, _box.y + _box.height / 2);`);
    lines.push(`        await page.mouse.wheel(0, ${scrollConfig.amount || 500});`);
    lines.push(`      }`);
    lines.push(`    }`);
  } else {
    lines.push(`  {`);
    lines.push(`    await page.mouse.wheel(0, ${scrollConfig.direction === 'up' ? -(scrollConfig.amount || 500) : (scrollConfig.amount || 500)});`);
  }

  if (hasDelays(delays)) {
    lines.push(`    await _delay(${scrollDelay});`);
  }

  lines.push(`  }`);
  return lines.join('\n');
}

module.exports = { resolveDelays, hasDelays, generateDelayCode, generateScrollCode, generateHumanMouseCode, randomUserAgent };
