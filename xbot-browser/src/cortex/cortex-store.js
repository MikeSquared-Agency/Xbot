'use strict';

const { ToolIndex, configKey, toolKey } = require('./tool-index');

// ─── Helpers ───

function parseBody(body) {
  try { return JSON.parse(body); }
  catch { return {}; }
}

function nodeToConfig(node) {
  const data = parseBody(node.body);
  return {
    id: node.id,
    domain: node.title,
    url_pattern: data.url_pattern || '/*',
    title: node.title,
    description: data.description || '',
    tags: data.tags || null,
    visit_count: node.access_count || 0,
    created_at: node.created_at,
    updated_at: node.updated_at,
  };
}

function nodeToTool(node, configNode) {
  const data = parseBody(node.body);
  return {
    id: node.id,
    config_id: configNode?.id || null,
    name: node.title,
    description: data.description || '',
    input_schema: data.input_schema || [],
    execution: data.execution || {},
    failure_count: data.failure_count || 0,
    fallback_selectors: data.fallback_selectors || null,
    last_verified: node.updated_at,
    created_at: node.created_at,
    updated_at: node.updated_at,
    // Joined fields
    domain: data.domain || configNode?.title || null,
    url_pattern: data.url_pattern || '/*',
    config_title: configNode?.title || data.domain || null,
  };
}

function matchUrlPattern(pattern, pathname) {
  if (pattern === '/*' || pattern === '*') return true;
  const regexStr = '^' + pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    + '$';
  try {
    return new RegExp(regexStr).test(pathname);
  } catch {
    return false;
  }
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── CortexStore ───

class CortexStore {
  constructor(opts = {}) {
    this._httpBase = (opts.httpBase || process.env.CORTEX_HTTP_BASE || 'http://localhost:9091').replace(/\/$/, '');
    this._sourceAgent = opts.sourceAgent || process.env.CORTEX_SOURCE_AGENT || 'xbot';
    this._timeoutMs = opts.timeoutMs || Number(process.env.CORTEX_TIMEOUT_MS) || 2000;
    this._toolIndex = new ToolIndex(opts.toolIndexDir);
  }

  // ─── HTTP helpers ───

  async _post(path, body) {
    try {
      const res = await fetch(`${this._httpBase}${path}?gate=skip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': this._sourceAgent,
          'x-gate-override': 'true',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this._timeoutMs),
      });
      if (!res.ok) {
        console.warn(`[cortex] POST ${path} failed: ${res.status}`);
        return null;
      }
      const json = await res.json();
      return json.success ? json.data : null;
    } catch (err) {
      console.warn(`[cortex] POST ${path} error:`, err.message);
      return null;
    }
  }

  async _get(path, fallback = null) {
    try {
      const res = await fetch(`${this._httpBase}${path}`, {
        headers: { 'x-agent-id': this._sourceAgent },
        signal: AbortSignal.timeout(this._timeoutMs),
      });
      if (!res.ok) return fallback;
      const json = await res.json();
      return json.success ? json.data : fallback;
    } catch {
      return fallback;
    }
  }

  async _patch(nodeId, body) {
    try {
      const res = await fetch(`${this._httpBase}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': this._sourceAgent,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this._timeoutMs),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.success ? json.data : null;
    } catch {
      return null;
    }
  }

  async _delete(path) {
    try {
      const res = await fetch(`${this._httpBase}${path}?gate=skip`, {
        method: 'DELETE',
        headers: {
          'x-agent-id': this._sourceAgent,
          'x-gate-override': 'true',
        },
        signal: AbortSignal.timeout(this._timeoutMs),
      });
      if (!res.ok) return false;
      const json = await res.json();
      return !!json.success;
    } catch {
      return false;
    }
  }

  // ─── Config CRUD ───

  async createConfig({ domain, urlPattern, title, description, tags }) {
    const pattern = urlPattern || '/*';

    // Check ToolIndex for existing
    const existingId = this._toolIndex.get(configKey(domain, pattern));
    if (existingId) {
      const existing = await this._get(`/nodes/${existingId}`);
      if (existing) return nodeToConfig(existing);
    }

    const bodyData = {
      url_pattern: pattern,
      description: description || '',
      tags: tags || null,
      visit_count: 0,
    };

    const node = await this._post('/nodes', {
      kind: 'domain',
      title: domain,
      body: JSON.stringify(bodyData),
      importance: 0.5,
      tags: [domain, pattern],
      source_agent: this._sourceAgent,
    });

    if (!node) throw new Error('Failed to create config in Cortex');

    this._toolIndex.set(configKey(domain, pattern), node.id);
    return nodeToConfig({ ...node, title: domain, body: JSON.stringify(bodyData) });
  }

  async getConfigById(configId) {
    const node = await this._get(`/nodes/${configId}`);
    if (!node || node.kind?.toLowerCase() !== 'domain') return null;
    return nodeToConfig(node);
  }

  async getConfigsForDomain(domain) {
    const nodes = await this._get(
      `/nodes?kind=domain&tag=${encodeURIComponent(domain)}&limit=50`,
      [],
    );
    if (!Array.isArray(nodes)) return [];
    return nodes
      .filter(n => n.title === domain)
      .map(n => nodeToConfig(n));
  }

  async getConfigForDomainAndPattern(domain, urlPattern) {
    const configs = await this.getConfigsForDomain(domain);
    return configs.find(c => c.url_pattern === (urlPattern || '/*')) || null;
  }

  async updateConfig(configId, updates) {
    const node = await this._get(`/nodes/${configId}`);
    if (!node) return null;

    const data = parseBody(node.body);

    if (updates.urlPattern !== undefined) data.url_pattern = updates.urlPattern;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.title !== undefined) data.title = updates.title;

    const patchBody = { body: JSON.stringify(data) };
    if (updates.title !== undefined) patchBody.title = updates.title;

    const updated = await this._patch(configId, patchBody);
    if (!updated) return null;

    // Update index if pattern changed
    if (updates.urlPattern !== undefined) {
      // Remove old key, set new
      const oldPattern = parseBody(node.body).url_pattern || '/*';
      this._toolIndex.delete(configKey(node.title, oldPattern));
      this._toolIndex.set(configKey(updated.title || node.title, updates.urlPattern), configId);
    }

    return nodeToConfig({ ...updated, body: JSON.stringify(data) });
  }

  async deleteConfig(configId) {
    const node = await this._get(`/nodes/${configId}`);
    if (!node) return false;

    const data = parseBody(node.body);
    this._toolIndex.delete(configKey(node.title, data.url_pattern || '/*'));

    return this._delete(`/nodes/${configId}`);
  }

  // ─── Tool CRUD ───

  async addTool({ configId, name, description, inputSchema, execution }) {
    // Get parent config to determine domain
    const configNode = await this._get(`/nodes/${configId}`);
    if (!configNode) throw new Error(`Config "${configId}" not found`);

    const domain = configNode.title;
    const configData = parseBody(configNode.body);

    // Check for existing tool with same name (upsert)
    const existingId = this._toolIndex.get(toolKey(domain, name));
    if (existingId) {
      // Decay old node toward GC
      await this._patch(existingId, { importance: 0.1 });
    }

    const toolData = {
      description: description || '',
      input_schema: inputSchema || [],
      execution: execution || {},
      domain: domain,
      url_pattern: configData.url_pattern || '/*',
      failure_count: 0,
      fallback_selectors: null,
    };

    const node = await this._post('/nodes', {
      kind: 'tool',
      title: name,
      body: JSON.stringify(toolData),
      importance: 0.75,
      tags: [domain, name],
      source_agent: this._sourceAgent,
    });

    if (!node) throw new Error('Failed to create tool in Cortex');

    // Create edge: config → tool
    await this._post('/edges', {
      from_id: configId,
      to_id: node.id,
      relation: 'has_tool',
      weight: 1.0,
    });

    // If superseding, create supersedes edge
    if (existingId) {
      await this._post('/edges', {
        from_id: node.id,
        to_id: existingId,
        relation: 'supersedes',
        weight: 1.0,
      });
    }

    // Update index
    this._toolIndex.set(toolKey(domain, name), node.id);

    return nodeToTool({ ...node, title: name, body: JSON.stringify(toolData) }, configNode);
  }

  async getToolById(toolId) {
    const node = await this._get(`/nodes/${toolId}`);
    if (!node || node.kind?.toLowerCase() !== 'tool') return null;

    // Try to find parent config via incoming edges
    const data = parseBody(node.body);
    let configNode = null;
    if (data.domain) {
      const configs = await this.getConfigsForDomain(data.domain);
      configNode = configs.find(c => c.url_pattern === (data.url_pattern || '/*'));
    }

    return nodeToTool(node, configNode ? { id: configNode.id, title: configNode.domain } : null);
  }

  async getToolByName(configId, name) {
    const configNode = await this._get(`/nodes/${configId}`);
    if (!configNode) return null;

    const neighbors = await this._get(
      `/nodes/${configId}/neighbors?depth=1&direction=outgoing`,
      [],
    );
    if (!Array.isArray(neighbors)) return null;

    for (const neighbor of neighbors) {
      const node = neighbor.node || neighbor;
      if (node.kind?.toLowerCase() === 'tool' && node.title === name) {
        return nodeToTool(node, configNode);
      }
    }
    return null;
  }

  async getToolsForConfig(configId) {
    const configNode = await this._get(`/nodes/${configId}`);
    if (!configNode) return [];

    const neighbors = await this._get(
      `/nodes/${configId}/neighbors?depth=1&direction=outgoing`,
      [],
    );
    if (!Array.isArray(neighbors)) return [];

    return neighbors
      .map(n => n.node || n)
      .filter(n => n.kind?.toLowerCase() === 'tool')
      .map(n => nodeToTool(n, configNode));
  }

  async getToolsForDomain(domain) {
    const configs = await this.getConfigsForDomain(domain);
    if (configs.length === 0) return [];

    const tools = [];
    for (const config of configs) {
      const configTools = await this.getToolsForConfig(config.id);
      tools.push(...configTools);
    }
    return tools;
  }

  async updateTool(toolId, updates) {
    const node = await this._get(`/nodes/${toolId}`);
    if (!node) return null;

    const data = parseBody(node.body);

    if (updates.name !== undefined) { /* title update handled below */ }
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.inputSchema !== undefined) data.input_schema = updates.inputSchema;
    if (updates.execution !== undefined) data.execution = updates.execution;
    if (updates.failureCount !== undefined) data.failure_count = updates.failureCount;
    if (updates.fallbackSelectors !== undefined) data.fallback_selectors = updates.fallbackSelectors;

    const patchBody = { body: JSON.stringify(data) };
    if (updates.name !== undefined) patchBody.title = updates.name;

    const updated = await this._patch(toolId, patchBody);
    if (!updated) return null;

    // Update index if name changed
    if (updates.name !== undefined && data.domain) {
      this._toolIndex.delete(toolKey(data.domain, node.title));
      this._toolIndex.set(toolKey(data.domain, updates.name), toolId);
    }

    return nodeToTool(
      { ...updated, title: updates.name || node.title, body: JSON.stringify(data) },
      data.domain ? { id: null, title: data.domain } : null,
    );
  }

  async deleteTool(toolId) {
    const node = await this._get(`/nodes/${toolId}`);
    if (!node) return false;

    const data = parseBody(node.body);
    if (data.domain) {
      this._toolIndex.delete(toolKey(data.domain, node.title));
    }

    return this._delete(`/nodes/${toolId}`);
  }

  // ─── Failure tracking ───

  async incrementFailureCount(toolId) {
    const node = await this._get(`/nodes/${toolId}`);
    if (!node) return 0;

    const data = parseBody(node.body);
    const newCount = (data.failure_count || 0) + 1;
    data.failure_count = newCount;

    await this._patch(toolId, { body: JSON.stringify(data) });
    return newCount;
  }

  async resetFailureCount(toolId) {
    const node = await this._get(`/nodes/${toolId}`);
    if (!node) return;

    const data = parseBody(node.body);
    data.failure_count = 0;

    await this._patch(toolId, { body: JSON.stringify(data) });
  }

  // ─── Lookup helpers ───

  async findToolsForUrl(domain, url) {
    // Get all domain nodes for this domain
    const domainNodes = await this._get(
      `/nodes?kind=domain&tag=${encodeURIComponent(domain)}&limit=50`,
      [],
    );
    if (!Array.isArray(domainNodes) || domainNodes.length === 0) return [];

    let pathname;
    try {
      const parsed = new URL(url);
      pathname = parsed.pathname + parsed.search;
    } catch {
      pathname = '/';
    }

    // Filter configs by URL pattern match
    const matchingConfigs = domainNodes
      .filter(n => n.title === domain)
      .map(n => ({ node: n, ...parseBody(n.body) }))
      .filter(c => matchUrlPattern(c.url_pattern || '/*', pathname));

    if (matchingConfigs.length === 0) return [];

    // Bump visit count for matching configs
    for (const config of matchingConfigs) {
      const data = parseBody(config.node.body);
      data.visit_count = (data.visit_count || 0) + 1;
      await this._patch(config.node.id, { body: JSON.stringify(data) });
    }

    // Get tool neighbors for each matching config
    const tools = [];
    for (const config of matchingConfigs) {
      const neighbors = await this._get(
        `/nodes/${config.node.id}/neighbors?depth=1&direction=outgoing`,
        [],
      );
      if (!Array.isArray(neighbors)) continue;

      for (const neighbor of neighbors) {
        const node = neighbor.node || neighbor;
        if (node.kind?.toLowerCase() === 'tool') {
          tools.push(nodeToTool(node, config.node));
        }
      }
    }

    return tools;
  }

  async findToolByNameForDomain(domain, toolName) {
    const tools = await this.getToolsForDomain(domain);
    return tools.find(t => t.name === toolName) || null;
  }

  async searchConfigsByQuery(query, limit = 1) {
    const results = await this._get(
      `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      [],
    );
    if (!Array.isArray(results)) return [];

    const configs = [];
    for (const result of results) {
      const node = result.node || result;
      if (node.kind?.toLowerCase() !== 'domain') continue;

      const config = nodeToConfig(node);

      // Get tools for this config
      const neighbors = await this._get(
        `/nodes/${node.id}/neighbors?depth=1&direction=outgoing`,
        [],
      );
      const toolNodes = (Array.isArray(neighbors) ? neighbors : [])
        .filter(n => (n.node || n).kind?.toLowerCase() === 'tool')
        .map(n => {
          const tn = n.node || n;
          const data = parseBody(tn.body);
          return { name: tn.title, description: data.description || '' };
        });

      configs.push({ ...config, tools: toolNodes });
    }

    return configs;
  }

  async findToolByName(toolName) {
    // Search for tool nodes by name tag
    const results = await this._get(
      `/nodes?kind=tool&tag=${encodeURIComponent(toolName)}&limit=1`,
      [],
    );
    if (!Array.isArray(results) || results.length === 0) return null;

    const node = results[0];
    const data = parseBody(node.body);

    let configNode = null;
    if (data.domain) {
      const configs = await this.getConfigsForDomain(data.domain);
      const match = configs.find(c => c.url_pattern === (data.url_pattern || '/*'));
      if (match) configNode = { id: match.id, title: match.domain };
    }

    return nodeToTool(node, configNode);
  }

  async close() {
    // No persistent connections to close for HTTP-based store
  }
}

module.exports = { CortexStore, extractDomain, matchUrlPattern };
