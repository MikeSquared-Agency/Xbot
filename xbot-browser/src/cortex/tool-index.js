'use strict';

const fs = require('fs');
const path = require('path');

class ToolIndex {
  constructor(dataDir = './data/cortex') {
    this._filePath = path.join(dataDir, 'tool-index.json');
    this._index = new Map();
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const obj = JSON.parse(raw);
      this._index = new Map(Object.entries(obj));
    } catch {
      this._index = new Map();
    }
  }

  _persist() {
    const obj = Object.fromEntries(this._index);
    fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
    fs.writeFileSync(this._filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  /** Get node ID for a tool or config. Returns string or null. */
  get(key) {
    return this._index.get(key) ?? null;
  }

  /** Set node ID for a tool or config. Persists to disk immediately. */
  set(key, nodeId) {
    this._index.set(key, nodeId);
    this._persist();
  }

  /** Delete an entry. */
  delete(key) {
    this._index.delete(key);
    this._persist();
  }

  /** Wipe everything (for tests). */
  clear() {
    this._index.clear();
    try { fs.unlinkSync(this._filePath); } catch {}
  }
}

function configKey(domain, urlPattern) {
  return `config:${domain}:${urlPattern}`;
}

function toolKey(domain, toolName) {
  return `tool:${domain}:${toolName}`;
}

module.exports = { ToolIndex, configKey, toolKey };
