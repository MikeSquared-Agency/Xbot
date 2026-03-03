'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class CortexStartupError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CortexStartupError';
  }
}

/**
 * Ensure Cortex is running. Starts it if CORTEX_AUTOSTART is true and it's not already up.
 *
 * @param {object} config
 * @param {string} config.httpBase - e.g., 'http://localhost:9091'
 * @param {string} config.dataDir - path to Cortex data directory
 * @param {string} [config.configPath] - path to cortex.toml
 * @param {boolean} [config.autostart=true]
 */
async function ensureCortexRunning(config) {
  if (config.autostart === false) return;

  const healthUrl = `${config.httpBase}/health`;

  // Already running?
  if (await isHealthy(healthUrl)) {
    console.error('[cortex] Already running');
    return;
  }

  // Check if model cache exists (first run takes longer)
  const modelCacheDir = path.join(os.homedir(), '.cache', 'cortex', 'models');
  const modelCacheExists = fs.existsSync(modelCacheDir);
  const timeoutMs = modelCacheExists ? 10_000 : 45_000;

  if (!modelCacheExists) {
    console.error('[cortex] First run — embedding model download expected (~150MB, up to 45s)');
  }

  console.error('[cortex] Starting...');

  const args = ['serve'];
  if (config.dataDir) args.push('--data-dir', config.dataDir);
  if (config.configPath) args.push('--config', config.configPath);

  const child = spawn('cortex', args, { stdio: 'ignore', detached: false });

  child.on('error', (err) => {
    console.error('[cortex] Failed to start:', err.message);
  });

  process.on('exit', () => {
    try { child.kill(); } catch {}
  });

  await waitForHealth(healthUrl, timeoutMs);
  console.error('[cortex] Ready');
}

async function isHealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body.success === true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new CortexStartupError(
    `Cortex did not become healthy within ${timeoutMs}ms. ` +
    `Install: curl -sSf https://raw.githubusercontent.com/MikeSquared-Agency/cortex/main/install.sh | sh`
  );
}

module.exports = { ensureCortexRunning, CortexStartupError };
