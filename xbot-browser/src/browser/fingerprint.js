'use strict';

/**
 * Returns a JavaScript string to be injected via page.addInitScript().
 * Patches common bot detection fingerprints.
 */
function getFingerprintScript() {
  return `
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Fake plugins array (Chrome-like)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // Stub chrome.runtime
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
      };
    }

    // Notification permission
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
      });
    }

    // Hide automation-related properties
    delete navigator.__proto__.webdriver;

    // Patch iframe contentWindow access detection
    const originalGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (originalGetter) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = originalGetter.get.call(this);
          if (win) {
            try {
              Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined });
            } catch {}
          }
          return win;
        },
      });
    }
  `;
}

/**
 * Generate Bezier curve control points for human-like mouse movement.
 * Returns an array of {x, y} points along the curve.
 *
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {number} steps - Number of intermediate points (default 20)
 * @returns {Array<{x: number, y: number}>}
 */
function generateBezierPath(startX, startY, endX, endY, steps = 20) {
  // Random control points with some deviation from the straight line
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
  const deviation = dist * 0.3;

  const cp1x = midX + (Math.random() - 0.5) * deviation;
  const cp1y = midY + (Math.random() - 0.5) * deviation;
  const cp2x = midX + (Math.random() - 0.5) * deviation;
  const cp2y = midY + (Math.random() - 0.5) * deviation;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
    const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  return points;
}

/**
 * Generate Playwright code for human-like mouse movement to a target.
 * Returns code lines that use page.mouse.move() along a Bezier curve.
 *
 * @param {string} targetLocator - Playwright locator expression string
 * @returns {string} Code string for human-like mouse movement + click
 */
function generateHumanMouseCode(targetLocator) {
  return [
    `  {`,
    `    const _target = ${targetLocator};`,
    `    const _box = await _target.boundingBox();`,
    `    if (_box) {`,
    `      const _endX = _box.x + _box.width / 2 + (Math.random() - 0.5) * _box.width * 0.3;`,
    `      const _endY = _box.y + _box.height / 2 + (Math.random() - 0.5) * _box.height * 0.3;`,
    `      const _startX = typeof _lastMouseX !== 'undefined' ? _lastMouseX : _endX - 100 + Math.random() * 200;`,
    `      const _startY = typeof _lastMouseY !== 'undefined' ? _lastMouseY : _endY - 100 + Math.random() * 200;`,
    `      const _steps = 15 + Math.floor(Math.random() * 10);`,
    `      const _midX = (_startX + _endX) / 2;`,
    `      const _midY = (_startY + _endY) / 2;`,
    `      const _dist = Math.sqrt((_endX - _startX) ** 2 + (_endY - _startY) ** 2);`,
    `      const _dev = _dist * 0.3;`,
    `      const _cp1x = _midX + (Math.random() - 0.5) * _dev;`,
    `      const _cp1y = _midY + (Math.random() - 0.5) * _dev;`,
    `      const _cp2x = _midX + (Math.random() - 0.5) * _dev;`,
    `      const _cp2y = _midY + (Math.random() - 0.5) * _dev;`,
    `      for (let _i = 0; _i <= _steps; _i++) {`,
    `        const _t = _i / _steps;`,
    `        const _mt = 1 - _t;`,
    `        const _x = _mt**3 * _startX + 3 * _mt**2 * _t * _cp1x + 3 * _mt * _t**2 * _cp2x + _t**3 * _endX;`,
    `        const _y = _mt**3 * _startY + 3 * _mt**2 * _t * _cp1y + 3 * _mt * _t**2 * _cp2y + _t**3 * _endY;`,
    `        await page.mouse.move(Math.round(_x), Math.round(_y));`,
    `        await page.waitForTimeout(5 + Math.floor(Math.random() * 15));`,
    `      }`,
    `      var _lastMouseX = _endX;`,
    `      var _lastMouseY = _endY;`,
    `      await _target.click();`,
    `    } else {`,
    `      await _target.click();`,
    `    }`,
    `  }`,
  ].join('\n');
}

// Pool of real Chrome user-agent strings (updated periodically)
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

/**
 * Pick a random user-agent from the pool.
 * @returns {string}
 */
function randomUserAgent() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

module.exports = {
  getFingerprintScript,
  generateBezierPath,
  generateHumanMouseCode,
  randomUserAgent,
  UA_POOL,
};
