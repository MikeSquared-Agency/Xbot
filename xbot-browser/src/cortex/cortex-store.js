'use strict';

/**
 * CortexStore — drop-in replacement for ActionStore.
 * Talks to Cortex HTTP API at localhost:9091 instead of PostgreSQL.
 *
 * Data model mapping:
 *   configs table → Cortex nodes with kind="domain"
 *   tools table   → Cortex nodes with kind="tool"
 *   config→tool   → Cortex edges with relation="has_tool"
 */
class CortexStore {
  /**
   * @param {object} options
   * @param {string} [options.httpBase='http://localhost:9091']
   * @param {number} [options.timeoutMs=2000]
   * @param {string} [options.sourceAgent='xbot']
   * @param {string} [options.toolIndexDir='./data/cortex']
   */
  constructor(options = {}) {
    // TODO: T5
  }

  // ── Config (Domain) Operations ──

  /**
   * Create a domain config.
   * @param {object} params
   * @param {string} params.domain
   * @param {string} params.urlPattern
   * @param {string} params.title
   * @param {string} params.description
   * @param {string[]} params.tags
   * @returns {Promise<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string}>}
   */
  async createConfig({ domain, urlPattern, title, description, tags }) {
    throw new Error('createConfig not implemented');
  }

  /**
   * Get config by Cortex node ID.
   * @param {string} configId
   * @returns {Promise<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string}|null>}
   */
  async getConfigById(configId) {
    throw new Error('getConfigById not implemented');
  }

  /**
   * Get all configs for a domain.
   * @param {string} domain
   * @returns {Promise<Array<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string}>>}
   */
  async getConfigsForDomain(domain) {
    throw new Error('getConfigsForDomain not implemented');
  }

  /**
   * Get config matching exact domain + url_pattern.
   * @param {string} domain
   * @param {string} urlPattern
   * @returns {Promise<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string}|null>}
   */
  async getConfigForDomainAndPattern(domain, urlPattern) {
    throw new Error('getConfigForDomainAndPattern not implemented');
  }

  /**
   * Update config fields.
   * @param {string} configId
   * @param {object} updates
   * @returns {Promise<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string}|null>}
   */
  async updateConfig(configId, updates) {
    throw new Error('updateConfig not implemented');
  }

  /**
   * Delete config and its associated tools.
   * @param {string} configId
   * @returns {Promise<boolean>}
   */
  async deleteConfig(configId) {
    throw new Error('deleteConfig not implemented');
  }

  // ── Tool Operations ──

  /**
   * Add tool to a config.
   * @param {object} params
   * @param {string} params.configId
   * @param {string} params.name
   * @param {string} params.description
   * @param {Array} params.inputSchema
   * @param {object} params.execution
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}>}
   */
  async addTool({ configId, name, description, inputSchema, execution }) {
    throw new Error('addTool not implemented');
  }

  /**
   * Get tool by Cortex node ID.
   * @param {string} toolId
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}|null>}
   */
  async getToolById(toolId) {
    throw new Error('getToolById not implemented');
  }

  /**
   * Get tool by config ID + name.
   * @param {string} configId
   * @param {string} name
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}|null>}
   */
  async getToolByName(configId, name) {
    throw new Error('getToolByName not implemented');
  }

  /**
   * Get all tools for a config.
   * @param {string} configId
   * @returns {Promise<Array<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}>>}
   */
  async getToolsForConfig(configId) {
    throw new Error('getToolsForConfig not implemented');
  }

  /**
   * Get all tools for a domain (joins config info).
   * @param {string} domain
   * @returns {Promise<Array<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string, domain: string, url_pattern: string, config_title: string}>>}
   */
  async getToolsForDomain(domain) {
    throw new Error('getToolsForDomain not implemented');
  }

  /**
   * Update tool fields.
   * @param {string} toolId
   * @param {object} updates
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}|null>}
   */
  async updateTool(toolId, updates) {
    throw new Error('updateTool not implemented');
  }

  /**
   * Delete tool.
   * @param {string} toolId
   * @returns {Promise<boolean>}
   */
  async deleteTool(toolId) {
    throw new Error('deleteTool not implemented');
  }

  // ── Failure Tracking ──

  /**
   * Increment failure_count on tool.
   * @param {string} toolId
   * @returns {Promise<number>} New failure count.
   */
  async incrementFailureCount(toolId) {
    throw new Error('incrementFailureCount not implemented');
  }

  /**
   * Reset failure_count to 0 on tool.
   * @param {string} toolId
   * @returns {Promise<void>}
   */
  async resetFailureCount(toolId) {
    throw new Error('resetFailureCount not implemented');
  }

  // ── Lookup Helpers ──

  /**
   * Find tools matching domain + URL pattern.
   * @param {string} domain
   * @param {string} url
   * @returns {Promise<Array<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string, domain: string, url_pattern: string, config_title: string}>>}
   */
  async findToolsForUrl(domain, url) {
    throw new Error('findToolsForUrl not implemented');
  }

  /**
   * Find tool by name scoped to domain.
   * @param {string} domain
   * @param {string} toolName
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string, domain: string, url_pattern: string, config_title: string}|null>}
   */
  async findToolByNameForDomain(domain, toolName) {
    throw new Error('findToolByNameForDomain not implemented');
  }

  /**
   * Semantic search for configs.
   * @param {string} query
   * @param {number} [limit=1]
   * @returns {Promise<Array<{id: string, domain: string, url_pattern: string, title: string, description: string, tags: string[], visit_count: number, created_at: string, updated_at: string, tools: Array<{name: string, description: string}>}>>}
   */
  async searchConfigsByQuery(query, limit = 1) {
    throw new Error('searchConfigsByQuery not implemented');
  }

  /**
   * Find tool by name globally.
   * @param {string} toolName
   * @returns {Promise<{id: string, config_id: string, name: string, description: string, input_schema: Array, execution: object, failure_count: number, fallback_selectors: null, last_verified: string, created_at: string, updated_at: string}|null>}
   */
  async findToolByName(toolName) {
    throw new Error('findToolByName not implemented');
  }

  /**
   * No-op — Cortex connections don't need explicit cleanup.
   * @returns {Promise<void>}
   */
  async close() {
    // No-op for Cortex — no persistent connections to clean up.
  }
}

module.exports = { CortexStore };
