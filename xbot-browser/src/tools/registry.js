'use strict';

const { extractDomain } = require('../utils');

class ToolRegistry {
  constructor(store) {
    this._store = store;
    this._currentDomain = null;
    this._currentUrl = null;
    this._currentTools = [];
    this._currentConfigs = [];
    this._lastLookedUpUrl = null;
  }

  get currentDomain() { return this._currentDomain; }
  get currentUrl() { return this._currentUrl; }
  get currentTools() { return this._currentTools; }
  get currentConfigs() { return this._currentConfigs; }
  get lastLookedUpUrl() { return this._lastLookedUpUrl; }

  resetPageState() {
    this._lastLookedUpUrl = null;
  }

  async lookupToolsForUrl(url) {
    const domain = extractDomain(url);
    this._currentDomain = domain;
    this._currentUrl = url;
    this._lastLookedUpUrl = url;

    if (domain) {
      this._currentConfigs = await this._store.getConfigsForDomain(domain);
      this._currentTools = await this._store.findToolsForUrl(domain, url);
    } else {
      this._currentConfigs = [];
      this._currentTools = [];
    }
  }

  async refreshCurrentTools() {
    if (this._currentDomain && this._currentUrl) {
      this._currentTools = await this._store.findToolsForUrl(this._currentDomain, this._currentUrl);
    }
  }

  async refreshCurrentConfigs() {
    if (this._currentDomain) {
      this._currentConfigs = await this._store.getConfigsForDomain(this._currentDomain);
    }
  }

  formatToolList() {
    return this._currentTools.map(t => {
      const params = (t.input_schema || []).map(p => p.name).join(', ');
      return `  <tool name="${t.name}" params="${params}">${t.description}</tool>`;
    }).join('\n');
  }

  formatToolNames() {
    return this._currentTools.map(t => t.name).join(', ');
  }

  async resolveToolByName(toolName) {
    let tool = this._currentTools.find(t => t.name === toolName);
    if (!tool && this._currentDomain) {
      tool = await this._store.findToolByNameForDomain(this._currentDomain, toolName);
    }
    if (!tool) {
      tool = await this._store.findToolByName(toolName);
    }
    // Skip ghost nodes (deleted nodes with empty body still appear via neighbor edges)
    if (tool && (!tool.execution || Object.keys(tool.execution).length === 0)) {
      tool = await this._store.findToolByName(toolName);
    }
    return tool;
  }
}

module.exports = { ToolRegistry };
