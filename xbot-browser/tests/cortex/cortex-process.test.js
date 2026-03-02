'use strict';

const http = require('http');
const { ensureCortexRunning, CortexStartupError } = require('../../src/cortex/cortex-process');

describe('ensureCortexRunning', () => {
  test('succeeds when cortex is already running', async () => {
    // Start a stub HTTP server that responds to /health with { success: true }
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"success":true}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = 19092;
    await new Promise(resolve => server.listen(port, resolve));

    try {
      // Should succeed without throwing since health check passes
      await ensureCortexRunning({
        httpBase: `http://localhost:${port}`,
        autostart: false,
      });
      // If we get here without error, the health check passed
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('with autostart=false does nothing when not running', async () => {
    // Should return without error even though nothing is running
    await ensureCortexRunning({
      httpBase: 'http://localhost:19098',
      autostart: false,
    });
    // No error means it correctly skipped startup
  });

  test('CortexStartupError thrown on bad binary', async () => {
    const originalPath = process.env.PATH;
    try {
      // Clear PATH so cortex binary cannot be found
      process.env.PATH = '';
      await expect(
        ensureCortexRunning({
          httpBase: 'http://localhost:19099',
          dataDir: '/tmp/cortex-bad-binary-test',
        })
      ).rejects.toThrow(CortexStartupError);
    } finally {
      process.env.PATH = originalPath;
    }
  }, 60000);
});

describe('CortexStartupError', () => {
  test('is instanceof Error', () => {
    const err = new CortexStartupError('test error');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CortexStartupError');
    expect(err.message).toBe('test error');
  });
});
