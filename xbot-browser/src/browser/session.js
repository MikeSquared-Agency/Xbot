'use strict';

const fs = require('fs');
const path = require('path');

function loadSession(config, sessionFilePath) {
  if (!sessionFilePath) return;
  const resolved = path.resolve(sessionFilePath);
  if (!fs.existsSync(resolved)) return;

  try {
    const data = fs.readFileSync(resolved, 'utf-8');
    JSON.parse(data); // Validate JSON
    if (!config.browser) config.browser = {};
    if (!config.browser.contextOptions) config.browser.contextOptions = {};
    config.browser.contextOptions.storageState = resolved;
  } catch {}
}

async function saveSession(context, sessionFilePath) {
  if (!sessionFilePath || !context) return;
  const resolved = path.resolve(sessionFilePath);

  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const state = await context.storageState();
    fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
  } catch {}
}

module.exports = { loadSession, saveSession };
