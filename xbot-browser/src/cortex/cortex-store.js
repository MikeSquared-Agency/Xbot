'use strict';

const { ToolIndex } = require('./tool-index');
const { matchUrlPattern } = require('../action-store');

class CortexStore {
  constructor({ httpBase, toolIndexDir }) {
    this._httpBase = httpBase.replace(/\/+$/, '');
    this._index = new ToolIndex({ dataDir: toolIndexDir });
  }

  // ─── HTTP helpers ───

  async _request(method, path, body) {
    const url = `${this._httpBase}${path}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Cortex ${method} ${path} failed: ${res.status} ${text}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async _safeRequest(method, path, body) {
    try {
      return await this._request(method, path, body);
    } catch {
      return null;
    }
  }

  // ─── Config CRUD ───

  async createConfig({ domain, urlPattern, title, description, tags }) {
    const resolvedPattern = urlPattern || '/*';
    const resolvedTitle = title || domain;
    const resolvedDescription = description || '';
    const resolvedTags = tags || [];

    const node = await this._request('POST', '/nodes', {
      label: 'config',
      properties: {
        domain,
        url_pattern: resolvedPattern,
        title: resolvedTitle,
        description: resolvedDescription,
        tags: resolvedTags,
        visit_count: 0,
      },
    });

    const key = this._index.configKey(domain, resolvedPattern);
    this._index.set(key, node.id);

    return {
      id: node.id,
      domain,
      url_pattern: resolvedPattern,
      title: resolvedTitle,
      description: resolvedDescription,
      tags: resolvedTags,
      ...node.properties,
    };
  }

  async getConfigsForDomain(domain) {
    const result = await this._safeRequest('POST', '/query', {
      label: 'config',
      filters: { domain },
    });
    if (!result) return [];
    return result.map(n => ({ id: n.id, ...n.properties }));
  }

  async getConfigForDomainAndPattern(domain, urlPattern) {
    const result = await this._safeRequest('POST', '/query', {
      label: 'config',
      filters: { domain, url_pattern: urlPattern },
    });
    if (!result || result.length === 0) return null;
    const n = result[0];
    return { id: n.id, ...n.properties };
  }

  // ─── Tool CRUD ───

  async addTool({ configId, name, description, inputSchema, execution }) {
    // Supersede: remove existing tool with same name under same config
    const existingKey = this._index.toolKey(configId, name);
    const existingId = this._index.get(existingKey);
    if (existingId) {
      await this._safeRequest('DELETE', `/nodes/${existingId}`);
    }

    const node = await this._request('POST', '/nodes', {
      label: 'tool',
      properties: {
        name,
        description: description || '',
        input_schema: inputSchema || {},
        execution: execution || {},
        failure_count: 0,
        last_verified: new Date().toISOString(),
      },
    });

    await this._request('POST', '/edges', {
      from: configId,
      to: node.id,
      label: 'HAS_TOOL',
    });

    this._index.set(existingKey, node.id);

    return {
      id: node.id,
      config_id: configId,
      name,
      description: description || '',
      input_schema: inputSchema || {},
      execution: execution || {},
      failure_count: 0,
      ...node.properties,
    };
  }

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

    const matching = configs.filter(c => matchUrlPattern(c.url_pattern, pathname));
    if (matching.length === 0) return [];

    const tools = [];
    for (const config of matching) {
      const edges = await this._safeRequest('POST', '/query/edges', {
        from: config.id,
        label: 'HAS_TOOL',
      });
      if (!edges) continue;
      for (const edge of edges) {
        const node = await this._safeRequest('GET', `/nodes/${edge.to}`);
        if (node) {
          tools.push({
            id: node.id,
            ...node.properties,
            domain: config.domain,
            url_pattern: config.url_pattern,
            config_title: config.title,
            config_id: config.id,
          });
        }
      }
    }
    return tools;
  }

  async updateTool(toolId, updates) {
    const existing = await this._request('GET', `/nodes/${toolId}`);
    if (!existing) return null;

    const merged = { ...existing.properties, ...updates };
    const node = await this._request('PATCH', `/nodes/${toolId}`, {
      properties: merged,
    });

    return { id: node.id, ...node.properties };
  }

  async deleteTool(toolId) {
    try {
      await this._request('DELETE', `/nodes/${toolId}`);
      return true;
    } catch (err) {
      if (err.status === 404) return false;
      throw err;
    }
  }

  // ─── Failure tracking ───

  async incrementFailureCount(toolId) {
    const node = await this._request('GET', `/nodes/${toolId}`);
    const current = (node.properties.failure_count || 0) + 1;
    await this._request('PATCH', `/nodes/${toolId}`, {
      properties: { ...node.properties, failure_count: current },
    });
    return current;
  }

  async resetFailureCount(toolId) {
    const node = await this._request('GET', `/nodes/${toolId}`);
    await this._request('PATCH', `/nodes/${toolId}`, {
      properties: {
        ...node.properties,
        failure_count: 0,
        last_verified: new Date().toISOString(),
      },
    });
  }

  // ─── Lookup helpers ───

  async searchConfigsByQuery(query, limit = 1) {
    const result = await this._safeRequest('POST', '/search', {
      text: query,
      label: 'config',
      limit,
    });
    if (!result) return [];

    const configs = [];
    for (const r of result) {
      const config = { id: r.id, ...r.properties };
      const edges = await this._safeRequest('POST', '/query/edges', {
        from: r.id,
        label: 'HAS_TOOL',
      });
      const tools = [];
      if (edges) {
        for (const edge of edges) {
          const node = await this._safeRequest('GET', `/nodes/${edge.to}`);
          if (node) {
            tools.push({ name: node.properties.name, description: node.properties.description });
          }
        }
      }
      configs.push({ ...config, tools });
    }
    return configs;
  }

  async findToolByName(toolName) {
    const result = await this._safeRequest('POST', '/query', {
      label: 'tool',
      filters: { name: toolName },
      limit: 1,
    });
    if (!result || result.length === 0) return null;

    const node = result[0];
    // Resolve parent config via reverse edge lookup
    const edges = await this._safeRequest('POST', '/query/edges', {
      to: node.id,
      label: 'HAS_TOOL',
    });
    let configMeta = {};
    if (edges && edges.length > 0) {
      const configNode = await this._safeRequest('GET', `/nodes/${edges[0].from}`);
      if (configNode) {
        configMeta = {
          domain: configNode.properties.domain,
          url_pattern: configNode.properties.url_pattern,
        };
      }
    }

    return { id: node.id, ...node.properties, ...configMeta };
  }

  async findToolByNameForDomain(domain, toolName) {
    const configs = await this.getConfigsForDomain(domain);
    for (const config of configs) {
      const edges = await this._safeRequest('POST', '/query/edges', {
        from: config.id,
        label: 'HAS_TOOL',
      });
      if (!edges) continue;
      for (const edge of edges) {
        const node = await this._safeRequest('GET', `/nodes/${edge.to}`);
        if (node && node.properties.name === toolName) {
          return {
            id: node.id,
            ...node.properties,
            domain: config.domain,
            url_pattern: config.url_pattern,
          };
        }
      }
    }
    return null;
  }
}

module.exports = { CortexStore };
