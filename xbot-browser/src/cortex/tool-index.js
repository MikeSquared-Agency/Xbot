'use strict';

/**
 * In-memory index mapping composite keys to Cortex node IDs.
 * Used for fast upsert checks without hitting the API.
 */
class ToolIndex {
  constructor() {
    this._map = new Map();
  }

  get(key) {
    return this._map.get(key) || null;
  }

  set(key, nodeId) {
    this._map.set(key, nodeId);
  }

  delete(key) {
    return this._map.delete(key);
  }

  has(key) {
    return this._map.has(key);
  }

  clear() {
    this._map.clear();
  }
}

function configKey(domain, urlPattern) {
  return `config:${domain}:${urlPattern || '/*'}`;
}

function toolKey(domain, name) {
  return `tool:${domain}:${name}`;
}

module.exports = { ToolIndex, configKey, toolKey };
