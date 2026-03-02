'use strict';

const { execSync, spawn } = require('child_process');

class CortexStartupError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CortexStartupError';
    if (cause) this.cause = cause;
  }
}

function findCortexBinary() {
  try {
    return execSync('which cortex', { encoding: 'utf-8' }).trim();
  } catch {}

  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.join(process.env.HOME || '', '.cortex', 'bin', 'cortex'),
    '/usr/local/bin/cortex',
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

async function ensureCortexRunning({ port = 7700, dataDir, autostart = true } = {}) {
  // Probe existing instance
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      return { port, alreadyRunning: true, started: false };
    }
  } catch {}

  if (!autostart) {
    return { port, alreadyRunning: false, started: false };
  }

  const binary = findCortexBinary();
  if (!binary) {
    throw new CortexStartupError('cortex binary not found in PATH or standard locations');
  }

  const args = ['serve', '--http-port', String(port)];
  if (dataDir) args.push('--data-dir', dataDir);

  const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
  child.unref();

  // Wait for health
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        return { port, alreadyRunning: false, started: true, pid: child.pid };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  try { child.kill(); } catch {}
  throw new CortexStartupError(`cortex did not become healthy on port ${port} within 15s`);
}

module.exports = { ensureCortexRunning, CortexStartupError };
