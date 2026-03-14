'use strict';

const {
  getFingerprintScript,
  generateBezierPath,
  generateHumanMouseCode,
  randomUserAgent,
  UA_POOL,
} = require('../../src/browser/fingerprint');

describe('getFingerprintScript', () => {
  test('returns a non-empty string', () => {
    const script = getFingerprintScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  test('contains navigator.webdriver override', () => {
    const script = getFingerprintScript();
    expect(script).toContain('navigator');
    expect(script).toContain('webdriver');
  });

  test('contains navigator.plugins fake', () => {
    const script = getFingerprintScript();
    expect(script).toContain('navigator');
    expect(script).toContain('plugins');
    expect(script).toContain('Chrome PDF Plugin');
  });

  test('contains chrome.runtime stub', () => {
    const script = getFingerprintScript();
    expect(script).toContain('chrome.runtime');
    expect(script).toContain('connect');
    expect(script).toContain('sendMessage');
  });

  test('contains Notification.permission patch', () => {
    const script = getFingerprintScript();
    expect(script).toContain('Notification');
    expect(script).toContain('permission');
    expect(script).toContain('default');
  });
});

describe('generateBezierPath', () => {
  test('returns array of {x, y} points', () => {
    const points = generateBezierPath(0, 0, 100, 100);
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point).toHaveProperty('x');
      expect(point).toHaveProperty('y');
      expect(typeof point.x).toBe('number');
      expect(typeof point.y).toBe('number');
    }
  });

  test('first point is near start coordinates', () => {
    const startX = 50, startY = 75;
    const points = generateBezierPath(startX, startY, 300, 400);
    // First point should be exactly the start (since t=0 gives 100% weight to start)
    expect(points[0].x).toBe(startX);
    expect(points[0].y).toBe(startY);
  });

  test('last point is near end coordinates', () => {
    const endX = 300, endY = 400;
    const points = generateBezierPath(0, 0, endX, endY);
    const last = points[points.length - 1];
    // Last point should be exactly the end (since t=1 gives 100% weight to end)
    expect(last.x).toBe(endX);
    expect(last.y).toBe(endY);
  });

  test('returns specified number of steps + 1 points', () => {
    const steps = 10;
    const points = generateBezierPath(0, 0, 100, 100, steps);
    // Loop goes from 0 to steps inclusive, so steps+1 points
    expect(points).toHaveLength(steps + 1);
  });

  test('returns default 21 points (20 steps + 1)', () => {
    const points = generateBezierPath(0, 0, 100, 100);
    expect(points).toHaveLength(21);
  });

  test('points are rounded integers', () => {
    const points = generateBezierPath(0, 0, 100, 100, 15);
    for (const point of points) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
  });
});

describe('generateHumanMouseCode', () => {
  test('returns string containing mouse.move', () => {
    const code = generateHumanMouseCode('page.locator("#btn")');
    expect(typeof code).toBe('string');
    expect(code).toContain('mouse.move');
  });

  test('returns string containing Bezier curve math', () => {
    const code = generateHumanMouseCode('page.locator("#target")');
    // The code contains cubic Bezier computation variables
    expect(code).toContain('_cp1x');
    expect(code).toContain('_cp2x');
    expect(code).toContain('_startX');
    expect(code).toContain('_endX');
  });

  test('contains the target locator reference', () => {
    const locator = 'page.locator("#my-button")';
    const code = generateHumanMouseCode(locator);
    expect(code).toContain(locator);
  });

  test('contains a click() call', () => {
    const code = generateHumanMouseCode('page.locator(".action")');
    expect(code).toContain('.click()');
  });

  test('contains boundingBox for position calculation', () => {
    const code = generateHumanMouseCode('page.locator("#el")');
    expect(code).toContain('boundingBox');
  });
});

describe('randomUserAgent', () => {
  test('returns a string from the UA_POOL', () => {
    const ua = randomUserAgent();
    expect(typeof ua).toBe('string');
    expect(UA_POOL).toContain(ua);
  });

  test('returns different values over many calls (probabilistic)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      results.add(randomUserAgent());
    }
    // With 5 entries and 50 draws, we should see at least 2 different ones
    expect(results.size).toBeGreaterThanOrEqual(2);
  });
});

describe('UA_POOL', () => {
  test('has at least 3 entries', () => {
    expect(UA_POOL.length).toBeGreaterThanOrEqual(3);
  });

  test('all entries are Chrome user-agent strings', () => {
    for (const ua of UA_POOL) {
      expect(typeof ua).toBe('string');
      expect(ua).toContain('Chrome/');
      expect(ua).toContain('AppleWebKit/');
    }
  });
});
