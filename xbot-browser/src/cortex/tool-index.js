'use strict';

const fs = require('fs');
const path = require('path');

class ToolIndex {
  constructor({ dataDir }) {
    this._dataDir = dataDir;
    this._indexPath = path.join(dataDir, 'tool-index.json');
    this._data = null;
  }

  _load() {
    if (this._data !== null) return;
    try {
      const raw = fs.readFileSync(this._indexPath, 'utf-8');
      this._data = JSON.parse(raw);
    } catch {
      this._data = {};
    }
  }

  _save() {
    fs.mkdirSync(this._dataDir, { recursive: true });
    fs.writeFileSync(this._indexPath, JSON.stringify(this._data, null, 2));
  }

  set(key, nodeId) {
    this._load();
    this._data[key] = nodeId;
    this._save();
  }

  get(key) {
    this._load();
    return this._data[key] ?? null;
  }

  clear() {
    this._data = {};
    try {
      fs.unlinkSync(this._indexPath);
    } catch {}
  }

  configKey(domain, pattern) {
    return `config:${domain}:${pattern}`;
  }

  toolKey(configId, toolName) {
    return `tool:${configId}:${toolName}`;
  }
}

module.exports = { ToolIndex };
