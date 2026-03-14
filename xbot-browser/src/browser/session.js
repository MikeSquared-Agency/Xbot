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

/**
 * Create a debounced auto-saver that persists session state
 * after navigations and actions.
 *
 * @param {string} sessionFilePath - Path to save session state
 * @param {number} [debounceMs=3000] - Debounce delay in milliseconds
 * @returns {{ schedule(context): void, flush(context): Promise<void> } | null}
 */
function createAutoSaver(sessionFilePath, debounceMs = 3000) {
  if (!sessionFilePath) return null;
  let timer = null;

  return {
    schedule(context) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        try {
          await saveSession(context, sessionFilePath);
        } catch {} // swallow — auto-save is best-effort
      }, debounceMs);
    },

    async flush(context) {
      if (timer) clearTimeout(timer);
      timer = null;
      await saveSession(context, sessionFilePath);
    },
  };
}

module.exports = { loadSession, saveSession, createAutoSaver };
