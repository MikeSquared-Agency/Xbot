'use strict';

const http = require('http');
const { ensureCortexRunning, CortexStartupError } = require('../../src/cortex/cortex-process');

describe('ensureCortexRunning', () => {
  test('succeeds when cortex is already running', async () => {
    // Start a stub HTTP server that responds to /health
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"ok"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = 19092;
    await new Promise(resolve => server.listen(port, resolve));

    try {
      const result = await ensureCortexRunning({ port, autostart: false });
      expect(result.alreadyRunning).toBe(true);
      expect(result.port).toBe(port);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('with autostart=false does nothing when not running', async () => {
    const result = await ensureCortexRunning({ port: 19098, autostart: false });
    expect(result.alreadyRunning).toBe(false);
    expect(result.started).toBe(false);
  });

  test('CortexStartupError thrown on bad binary', async () => {
    const originalPath = process.env.PATH;
    try {
      // Clear PATH so cortex binary cannot be found
      process.env.PATH = '';
      await expect(
        ensureCortexRunning({ port: 19099, dataDir: '/tmp/cortex-bad-binary-test' })
      ).rejects.toThrow(CortexStartupError);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('CortexStartupError', () => {
  test('is instanceof Error', () => {
    const err = new CortexStartupError('test error');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CortexStartupError');
    expect(err.message).toBe('test error');
  });
});
