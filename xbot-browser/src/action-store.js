'use strict';

const { Pool } = require('pg');
const path = require('path');

// Load .env from project root
const envPath = path.join(__dirname, '..', '..', '.env');
try {
  const fs = require('fs');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

class ActionStore {
  constructor() {
    if (!process.env.DATABASE_URL)
      throw new Error('Missing required environment variable: DATABASE_URL');

    const poolConfig = { connectionString: process.env.DATABASE_URL };
    if (process.env.DATABASE_SSL === 'true')
      poolConfig.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' };

    this._pool = new Pool(poolConfig);
    this._embedder = null; // Lazy-loaded local embedding pipeline
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
    const resolvedTitle = title || domain;
    const resolvedDescription = description || '';
    const resolvedTags = tags || [];

    const embedInput = `${resolvedTitle}. ${resolvedDescription}. ${resolvedTags.join(' ')}`;
    const embedding = await this._embed(embedInput);
    const embeddingStr = '[' + embedding.join(',') + ']';

    const res = await this._pool.query(
      `INSERT INTO configs (domain, url_pattern, title, description, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       RETURNING *`,
      [domain, urlPattern || '/*', resolvedTitle, resolvedDescription, tags ? JSON.stringify(tags) : null, embeddingStr]
    );
    return res.rows[0];
  }

  async getConfigById(configId) {
    const res = await this._pool.query('SELECT * FROM configs WHERE id = $1', [configId]);
    return res.rows[0] || null;
  }

  async getConfigsForDomain(domain) {
    const res = await this._pool.query('SELECT * FROM configs WHERE domain = $1', [domain]);
    return res.rows;
  }

  async getConfigForDomainAndPattern(domain, urlPattern) {
    const res = await this._pool.query(
      'SELECT * FROM configs WHERE domain = $1 AND url_pattern = $2',
      [domain, urlPattern]
    );
    return res.rows[0] || null;
  }

  async updateConfig(configId, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const col = key === 'urlPattern' ? 'url_pattern' : key;
      fields.push(`"${col}" = $${idx}`);
      values.push(col === 'tags' ? JSON.stringify(val) : val);
      idx++;
    }
    if (fields.length === 0) return null;

    fields.push(`"updated_at" = now()`);
    values.push(configId);

    const res = await this._pool.query(
      `UPDATE configs SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  async deleteConfig(configId) {
    const res = await this._pool.query('DELETE FROM configs WHERE id = $1 RETURNING id', [configId]);
    return res.rowCount > 0;
  }

  // ─── Tool CRUD ───

  async addTool({ configId, name, description, inputSchema, execution }) {
    const res = await this._pool.query(
      `INSERT INTO tools (config_id, name, description, input_schema, execution, last_verified)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING *`,
      [configId, name, description || '', JSON.stringify(inputSchema || {}), JSON.stringify(execution || {})]
    );
    return res.rows[0];
  }

  async getToolById(toolId) {
    const res = await this._pool.query('SELECT * FROM tools WHERE id = $1', [toolId]);
    return res.rows[0] || null;
  }

  async getToolByName(configId, name) {
    const res = await this._pool.query(
      'SELECT * FROM tools WHERE config_id = $1 AND name = $2',
      [configId, name]
    );
    return res.rows[0] || null;
  }

  async getToolsForConfig(configId) {
    const res = await this._pool.query(
      'SELECT * FROM tools WHERE config_id = $1 ORDER BY created_at',
      [configId]
    );
    return res.rows;
  }

  async getToolsForDomain(domain) {
    const res = await this._pool.query(
      `SELECT t.*, c.domain, c.url_pattern, c.title as config_title
       FROM tools t
       JOIN configs c ON t.config_id = c.id
       WHERE c.domain = $1
       ORDER BY t.created_at`,
      [domain]
    );
    return res.rows;
  }

  async updateTool(toolId, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

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
      fields.push(`"${col}" = $${idx}`);
      const jsonCols = ['input_schema', 'execution', 'fallback_selectors'];
      values.push(jsonCols.includes(col) ? JSON.stringify(val) : val);
      idx++;
    }
    if (fields.length === 0) return null;

    fields.push(`"updated_at" = now()`);
    values.push(toolId);

    const res = await this._pool.query(
      `UPDATE tools SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  async deleteTool(toolId) {
    const res = await this._pool.query('DELETE FROM tools WHERE id = $1 RETURNING id', [toolId]);
    return res.rowCount > 0;
  }

  // ─── Failure tracking ───

  async incrementFailureCount(toolId) {
    const res = await this._pool.query(
      `UPDATE tools SET failure_count = failure_count + 1, updated_at = now()
       WHERE id = $1 RETURNING failure_count`,
      [toolId]
    );
    return res.rows[0]?.failure_count || 0;
  }

  async resetFailureCount(toolId) {
    await this._pool.query(
      `UPDATE tools SET failure_count = 0, last_verified = now(), updated_at = now()
       WHERE id = $1`,
      [toolId]
    );
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

    const configIds = matchingConfigs.map(c => c.id);
    const placeholders = configIds.map((_, i) => `$${i + 1}`).join(',');

    await this._pool.query(
      `UPDATE configs SET visit_count = visit_count + 1, updated_at = now()
       WHERE id IN (${placeholders})`,
      configIds
    );

    const res = await this._pool.query(
      `SELECT t.*, c.domain, c.url_pattern, c.title as config_title
       FROM tools t
       JOIN configs c ON t.config_id = c.id
       WHERE t.config_id IN (${placeholders})
       ORDER BY t.created_at`,
      configIds
    );
    return res.rows;
  }

  async findToolByNameForDomain(domain, toolName) {
    const res = await this._pool.query(
      `SELECT t.*, c.domain, c.url_pattern
       FROM tools t
       JOIN configs c ON t.config_id = c.id
       WHERE c.domain = $1 AND t.name = $2
       LIMIT 1`,
      [domain, toolName]
    );
    return res.rows[0] || null;
  }

  async searchConfigsByQuery(query, limit = 1) {
    const embedding = await this._embed(query);
    const embeddingStr = '[' + embedding.join(',') + ']';

    const res = await this._pool.query(
      `SELECT c.id, c.domain, c.url_pattern, c.title, c.description, c.tags
       FROM configs c
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [embeddingStr, limit]
    );

    const configs = [];
    for (const row of res.rows) {
      const toolsRes = await this._pool.query(
        'SELECT name, description FROM tools WHERE config_id = $1 ORDER BY created_at',
        [row.id]
      );
      configs.push({
        ...row,
        tools: toolsRes.rows,
      });
    }
    return configs;
  }

  async findToolByName(toolName) {
    const res = await this._pool.query(
      `SELECT t.*, c.domain, c.url_pattern
       FROM tools t
       JOIN configs c ON t.config_id = c.id
       WHERE t.name = $1
       LIMIT 1`,
      [toolName]
    );
    return res.rows[0] || null;
  }

  async close() {
    await this._pool.end();
  }
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

module.exports = {
  ActionStore,
  extractDomain,
  matchUrlPattern,
};
