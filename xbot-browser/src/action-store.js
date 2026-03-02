'use strict';

const { extractDomain, matchUrlPattern } = require('./utils');

let _nextConfigId = 1;
let _nextToolId = 1;

class ActionStore {
  constructor() {
    this._configs = new Map();
    this._tools = new Map();
    this._embedder = null;
  }

  // ─── Embedding (local, via @huggingface/transformers) ───

  async _embed(text) {
    if (!this._embedder) {
      const { pipeline } = await import('@huggingface/transformers');
      this._embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const output = await this._embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  // ─── Config CRUD ───

  async createConfig({ domain, urlPattern, title, description, tags }) {
    const id = String(_nextConfigId++);
    const now = new Date().toISOString();
    const resolvedTitle = title || domain;
    const resolvedDescription = description || '';
    const resolvedTags = tags || [];

    const embedInput = `${resolvedTitle}. ${resolvedDescription}. ${resolvedTags.join(' ')}`;
    const embedding = await this._embed(embedInput);

    const config = {
      id,
      domain,
      url_pattern: urlPattern || '/*',
      title: resolvedTitle,
      description: resolvedDescription,
      tags: resolvedTags,
      embedding,
      visit_count: 0,
      created_at: now,
      updated_at: now,
    };
    this._configs.set(id, config);
    return config;
  }

  async getConfigById(configId) {
    return this._configs.get(configId) || null;
  }

  async getConfigsForDomain(domain) {
    return [...this._configs.values()].filter(c => c.domain === domain);
  }

  async getConfigForDomainAndPattern(domain, urlPattern) {
    return [...this._configs.values()].find(
      c => c.domain === domain && c.url_pattern === urlPattern
    ) || null;
  }

  async updateConfig(configId, updates) {
    const config = this._configs.get(configId);
    if (!config) return null;
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const col = key === 'urlPattern' ? 'url_pattern' : key;
      config[col] = col === 'tags' ? (Array.isArray(val) ? val : JSON.parse(val)) : val;
    }
    config.updated_at = new Date().toISOString();
    return config;
  }

  async deleteConfig(configId) {
    return this._configs.delete(configId);
  }

  // ─── Tool CRUD ───

  async addTool({ configId, name, description, inputSchema, execution }) {
    const id = String(_nextToolId++);
    const now = new Date().toISOString();
    const tool = {
      id,
      config_id: configId,
      name,
      description: description || '',
      input_schema: inputSchema || [],
      execution: execution || {},
      last_verified: now,
      failure_count: 0,
      fallback_selectors: null,
      created_at: now,
      updated_at: now,
    };
    this._tools.set(id, tool);
    return tool;
  }

  async getToolById(toolId) {
    return this._tools.get(toolId) || null;
  }

  async getToolByName(configId, name) {
    return [...this._tools.values()].find(
      t => t.config_id === configId && t.name === name
    ) || null;
  }

  async getToolsForConfig(configId) {
    return [...this._tools.values()]
      .filter(t => t.config_id === configId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async getToolsForDomain(domain) {
    const configs = await this.getConfigsForDomain(domain);
    const configIds = new Set(configs.map(c => c.id));
    return [...this._tools.values()]
      .filter(t => configIds.has(t.config_id))
      .map(t => {
        const config = configs.find(c => c.id === t.config_id);
        return { ...t, domain: config.domain, url_pattern: config.url_pattern, config_title: config.title };
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async updateTool(toolId, updates) {
    const tool = this._tools.get(toolId);
    if (!tool) return null;
    const colMap = {
      inputSchema: 'input_schema',
      configId: 'config_id',
      lastVerified: 'last_verified',
      failureCount: 'failure_count',
      fallbackSelectors: 'fallback_selectors',
    };
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const col = colMap[key] || key;
      tool[col] = val;
    }
    tool.updated_at = new Date().toISOString();
    return tool;
  }

  async deleteTool(toolId) {
    return this._tools.delete(toolId);
  }

  // ─── Failure tracking ───

  async incrementFailureCount(toolId) {
    const tool = this._tools.get(toolId);
    if (!tool) return 0;
    tool.failure_count = (tool.failure_count || 0) + 1;
    tool.updated_at = new Date().toISOString();
    return tool.failure_count;
  }

  async resetFailureCount(toolId) {
    const tool = this._tools.get(toolId);
    if (!tool) return;
    tool.failure_count = 0;
    tool.last_verified = new Date().toISOString();
    tool.updated_at = new Date().toISOString();
  }

  // ─── Lookup helpers ───

  async findToolsForUrl(domain, url) {
    const configs = await this.getConfigsForDomain(domain);
    if (configs.length === 0) return [];

    let pathname;
    try {
      const parsed = new URL(url);
      pathname = parsed.pathname + parsed.search;
    } catch {
      pathname = '/';
    }

    const matchingConfigs = configs.filter(c => matchUrlPattern(c.url_pattern, pathname));
    if (matchingConfigs.length === 0) return [];

    for (const c of matchingConfigs) {
      c.visit_count = (c.visit_count || 0) + 1;
      c.updated_at = new Date().toISOString();
    }

    const configIds = new Set(matchingConfigs.map(c => c.id));
    return [...this._tools.values()]
      .filter(t => configIds.has(t.config_id))
      .map(t => {
        const config = matchingConfigs.find(c => c.id === t.config_id);
        return { ...t, domain: config.domain, url_pattern: config.url_pattern, config_title: config.title };
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async findToolByNameForDomain(domain, toolName) {
    const configs = await this.getConfigsForDomain(domain);
    const configIds = new Set(configs.map(c => c.id));
    const tool = [...this._tools.values()].find(
      t => configIds.has(t.config_id) && t.name === toolName
    );
    if (!tool) return null;
    const config = configs.find(c => c.id === tool.config_id);
    return { ...tool, domain: config.domain, url_pattern: config.url_pattern };
  }

  async findToolByName(toolName) {
    const tool = [...this._tools.values()].find(t => t.name === toolName);
    if (!tool) return null;
    const config = this._configs.get(tool.config_id);
    if (!config) return tool;
    return { ...tool, domain: config.domain, url_pattern: config.url_pattern };
  }

  async searchConfigsByQuery(query, limit = 1) {
    const embedding = await this._embed(query);

    const scored = [...this._configs.values()].map(config => {
      const sim = cosineSimilarity(embedding, config.embedding);
      return { config, sim };
    });
    scored.sort((a, b) => b.sim - a.sim);

    const results = [];
    for (const { config } of scored.slice(0, limit)) {
      const tools = await this.getToolsForConfig(config.id);
      results.push({
        id: config.id,
        domain: config.domain,
        url_pattern: config.url_pattern,
        title: config.title,
        description: config.description,
        tags: config.tags,
        tools: tools.map(t => ({ name: t.name, description: t.description })),
      });
    }
    return results;
  }

  async close() {}
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  ActionStore,
  extractDomain,
  matchUrlPattern,
};
