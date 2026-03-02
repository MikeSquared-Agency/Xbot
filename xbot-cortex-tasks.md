# Xbot × Cortex — Implementation Tasks (Corrected)

**Total tasks:** 10
**Estimated wall-clock time:** ~2 days with parallelisation vs ~4 days serial

> **Note:** This spec is written against the actual codebase (`xbot-browser/src/`, JavaScript, CommonJS)
> and the actual Cortex HTTP API (no `/v1/` prefix, no reinforce/decay endpoints, `relation` not `kind` on edges).

---

## Architecture Overview

### Current State

```
XbotBackend (xbot-backend.js)
├── _store: ActionStore (action-store.js) ← PostgreSQL + pgvector
├── _registry: ToolRegistry (tools/registry.js)
├── _fallback: FallbackTracker (tools/fallback.js)
└── _inner: BrowserServerBackend (Playwright MCP)
```

**Data model (Postgres):**
- `configs` table: domain, url_pattern, title, description, tags, embedding (vector 384)
- `tools` table: config_id (FK), name, description, input_schema (JSON array), execution (JSON), failure_count, fallback_selectors

### Target State

```
XbotBackend (xbot-backend.js)
├── _store: CortexStore (cortex/cortex-store.js) ← Cortex HTTP API
├── _registry: ToolRegistry (tools/registry.js) ← unchanged
├── _fallback: FallbackTracker (tools/fallback.js) ← unchanged
└── _inner: BrowserServerBackend (Playwright MCP) ← unchanged
```

**Data model (Cortex):**
- Domain nodes: `kind=domain`, title=domain name, body=JSON {url_pattern, description, tags}
- Tool nodes: `kind=tool`, title=tool name, body=JSON {description, input_schema, execution, domain, url_pattern, failure_count, fallback_selectors}
- Edges: domain --`has_tool`--> tool

### Key Design Decision: Drop-In Replacement

`CortexStore` implements the **same public interface** as `ActionStore` so that `ToolRegistry`, `XbotBackend`, and all callers work unchanged. This is not a new interface — it's a re-implementation of the existing one against a different backend.

---

## Cortex HTTP API Reference (Actual, Verified from Source)

All responses wrapped in `{ success: bool, data: ..., error: ... }`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check (returns version, uptime, stats) |
| `/nodes` | GET | List nodes. Query: `kind`, `tag`, `limit`, `offset` |
| `/nodes` | POST | Create node. Body: `{kind, title, body, tags, importance, source_agent}`. Query: `?gate=skip` with header `x-gate-override: true` to bypass write gate |
| `/nodes/:id` | GET | Get single node |
| `/nodes/:id` | PATCH | Update node. Body: `{kind?, title?, body?, tags?, importance?}` |
| `/nodes/:id` | DELETE | Soft-delete node |
| `/edges` | POST | Create edge. Body: `{from_id, to_id, relation, weight}`. Relation must be lowercase + underscores only |
| `/search` | GET | Vector search. Query: `q`, `limit` (default 10), `recency_bias` |
| `/search/hybrid` | GET | Hybrid search. Query: `q`, `limit`, `recency_bias` |
| `/briefing/:agent_id` | GET | Agent briefing. Query: `compact` |
| `/auto-linker/trigger` | POST | Trigger auto-link cycle |

**Gotchas:**
- `kind` in requests: lowercase (`"domain"`, `"tool"`)
- `kind` in responses: PascalCase (`"Domain"`, `"Tool"`) — via Rust Debug format
- `relation` on edges: lowercase + underscores only (e.g., `"has_tool"`, NOT `"HAS_TOOL"`)
- No `metadata` field on HTTP node creation — encode structured data in `body`
- No explicit reinforce/decay endpoints — use `PATCH /nodes/:id` with `{ importance: newValue }` for manual feedback
- Search results automatically increment `access_count` (implicit reinforcement)
- Write gate may reject nodes — use `?gate=skip` + `x-gate-override: true` header for tool storage

---

## Parallelisation Map

```
WAVE 0 (serial — unblocks everything)
└── T1: CortexStore class (drop-in replacement for ActionStore)

WAVE 1 (all parallel — no code deps)
├── T2: ToolIndex (local JSON index for upsert tracking)
├── T3: cortex-process.js (autostart)
└── T4: Config & infra (.env, cortex.toml, docker-compose, .gitignore)

WAVE 2 (serial — needs T1 + T2)
└── T5: CortexStore implementation

WAVE 3 (parallel — needs T5)
├── T6: XbotBackend integration (swap ActionStore → CortexStore)
├── T7: Cortex briefing injection in _handleNavigate
└── T8: Feedback hooks (importance adjustment on success/failure)

WAVE 4 (parallel — needs T6)
├── T9: Unit tests
└── T10: Integration tests + Postgres removal
```

---

## T1 — CortexStore Class Skeleton

**Wave:** 0
**Depends on:** nothing
**Blocks:** T5, T6, T7, T8
**Estimated effort:** 1–2h

### Context

`ActionStore` (action-store.js) is the storage layer used by `ToolRegistry` and `XbotBackend`. Every caller interacts with it through its public methods. `CortexStore` must expose the **exact same method signatures** so it can be swapped in with zero changes to callers.

### Task

Create `xbot-browser/src/cortex/cortex-store.js` with the full class skeleton — all method signatures with JSDoc, no implementation (all methods throw "not implemented"). This is the contract other tasks implement against.

### File to create

`xbot-browser/src/cortex/cortex-store.js`

### Required method signatures (matching ActionStore)

```javascript
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

  /** Create a domain config. Returns config-like object with { id, domain, url_pattern, title, ... } */
  async createConfig({ domain, urlPattern, title, description, tags }) {}

  /** Get config by Cortex node ID. Returns config-like object or null. */
  async getConfigById(configId) {}

  /** Get all configs for a domain. Returns array of config-like objects. */
  async getConfigsForDomain(domain) {}

  /** Get config matching exact domain + url_pattern. Returns config-like object or null. */
  async getConfigForDomainAndPattern(domain, urlPattern) {}

  /** Update config fields. Returns updated config-like object or null. */
  async updateConfig(configId, updates) {}

  /** Delete config (and its tools). Returns boolean. */
  async deleteConfig(configId) {}

  // ── Tool Operations ──

  /** Add tool to a config. Returns tool-like object with { id, name, config_id, ... } */
  async addTool({ configId, name, description, inputSchema, execution }) {}

  /** Get tool by Cortex node ID. Returns tool-like object or null. */
  async getToolById(toolId) {}

  /** Get tool by config ID + name. Returns tool-like object or null. */
  async getToolByName(configId, name) {}

  /** Get all tools for a config. Returns array of tool-like objects. */
  async getToolsForConfig(configId) {}

  /** Get all tools for a domain (joins config info). Returns array with domain, url_pattern, config_title. */
  async getToolsForDomain(domain) {}

  /** Update tool fields. Returns updated tool-like object or null. */
  async updateTool(toolId, updates) {}

  /** Delete tool. Returns boolean. */
  async deleteTool(toolId) {}

  // ── Failure Tracking ──

  /** Increment failure_count on tool. Returns new count. */
  async incrementFailureCount(toolId) {}

  /** Reset failure_count to 0 on tool. */
  async resetFailureCount(toolId) {}

  // ── Lookup Helpers ──

  /** Find tools matching domain + URL pattern. Returns array with domain, url_pattern, config_title. */
  async findToolsForUrl(domain, url) {}

  /** Find tool by name scoped to domain. Returns tool-like object or null. */
  async findToolByNameForDomain(domain, toolName) {}

  /** Semantic search for configs. Returns array of { ...config, tools: [{name, description}] }. */
  async searchConfigsByQuery(query, limit = 1) {}

  /** Find tool by name globally. Returns tool-like object or null. */
  async findToolByName(toolName) {}

  /** No-op — Cortex connections don't need explicit cleanup. */
  async close() {}
}

module.exports = { CortexStore };
```

### Return object shapes

`CortexStore` methods must return objects with the same field names callers expect:

**Config-like object** (used by ToolRegistry, XbotBackend):
```javascript
{
  id: 'cortex-node-uuid',     // Cortex node ID
  domain: 'amazon.com',
  url_pattern: '/*',
  title: 'Amazon',
  description: '...',
  tags: ['shopping'],
  visit_count: 0,             // tracked via Cortex access_count
  created_at: '...',
  updated_at: '...',
}
```

**Tool-like object** (used by XbotBackend._handleExecute, ToolRegistry):
```javascript
{
  id: 'cortex-node-uuid',     // Cortex node ID
  config_id: 'domain-node-uuid',
  name: 'search-products',
  description: '...',
  input_schema: [{ name: 'query', type: 'string', required: true }],  // parsed JSON
  execution: { fields: [...], submit: {...}, ... },                    // parsed JSON
  failure_count: 0,
  fallback_selectors: null,
  last_verified: '...',
  created_at: '...',
  updated_at: '...',
  // Joined fields (from findToolsForUrl, findToolByNameForDomain):
  domain: 'amazon.com',
  url_pattern: '/*',
  config_title: 'Amazon',
}
```

### Acceptance criteria

- File is valid JavaScript (CommonJS)
- All method signatures exactly match ActionStore's public interface
- No implementation code — all throw or return stubs
- JSDoc on every method
- Return object shapes documented

---

## T2 — ToolIndex

**Wave:** 1 (parallel)
**Depends on:** nothing
**Blocks:** T5
**Estimated effort:** 30min

### Context

Cortex doesn't support upsert — `POST /nodes` always creates new. We need a local index to track `${domain}:${toolName} → nodeId` so `CortexStore.addTool` can detect duplicates and supersede old nodes. Same for configs: `${domain}:${urlPattern} → nodeId`.

### File to create

`xbot-browser/src/cortex/tool-index.js`

```javascript
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

// Key helpers
function configKey(domain, urlPattern) {
  return `config:${domain}:${urlPattern}`;
}

function toolKey(domain, toolName) {
  return `tool:${domain}:${toolName}`;
}

module.exports = { ToolIndex, configKey, toolKey };
```

### Acceptance criteria

- Survives process restart (data persists to disk)
- `get` returns null for unknown keys
- Creates `data/cortex/` directory if missing
- Has unit test: set → get → new instance → get again

---

## T3 — cortex-process.js (Autostart)

**Wave:** 1 (parallel) — **no code deps**
**Depends on:** nothing
**Blocks:** nothing (consumed by T6 during startup)
**Estimated effort:** 1h

### Context

When `CORTEX_AUTOSTART=true` (default), xbot-browser should start the Cortex binary automatically. First run downloads a ~150MB embedding model, so the startup wait needs to be longer.

### File to create

`xbot-browser/src/cortex/cortex-process.js`

```javascript
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class CortexStartupError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CortexStartupError';
  }
}

/**
 * Ensure Cortex is running. Starts it if CORTEX_AUTOSTART is true and it's not already up.
 *
 * @param {object} config
 * @param {string} config.httpBase - e.g., 'http://localhost:9091'
 * @param {string} config.dataDir - path to Cortex data directory
 * @param {string} [config.configPath] - path to cortex.toml
 * @param {boolean} [config.autostart=true]
 */
async function ensureCortexRunning(config) {
  if (config.autostart === false) return;

  const healthUrl = `${config.httpBase}/health`;

  // Already running?
  if (await isHealthy(healthUrl)) {
    console.info('[cortex] Already running');
    return;
  }

  // Check if model cache exists (first run takes longer)
  const modelCacheDir = path.join(os.homedir(), '.cache', 'cortex', 'models');
  const modelCacheExists = fs.existsSync(modelCacheDir);
  const timeoutMs = modelCacheExists ? 10_000 : 45_000;

  if (!modelCacheExists) {
    console.info('[cortex] First run — embedding model download expected (~150MB, up to 45s)');
  }

  console.info('[cortex] Starting...');

  const args = ['serve'];
  if (config.dataDir) args.push('--data-dir', config.dataDir);
  if (config.configPath) args.push('--config', config.configPath);

  const child = spawn('cortex', args, { stdio: 'ignore', detached: false });

  child.on('error', (err) => {
    console.error('[cortex] Failed to start:', err.message);
  });

  process.on('exit', () => {
    try { child.kill(); } catch {}
  });

  await waitForHealth(healthUrl, timeoutMs);
  console.info('[cortex] Ready');
}

async function isHealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body.success === true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new CortexStartupError(
    `Cortex did not become healthy within ${timeoutMs}ms. ` +
    `Install: curl -sSf https://raw.githubusercontent.com/MikeSquared-Agency/cortex/main/install.sh | sh`
  );
}

module.exports = { ensureCortexRunning, CortexStartupError };
```

### Acceptance criteria

- Does not throw if Cortex is already running
- Correctly distinguishes first-run (no model cache) from warm start
- Child process is killed when parent exits
- Error message includes install instructions

---

## T4 — Config & Infrastructure

**Wave:** 1 (parallel) — **no code deps**
**Depends on:** nothing
**Blocks:** nothing
**Estimated effort:** 1h

### Files to create/modify

**`.env.example`** — add Cortex vars, keep existing vars, keep DATABASE_URL (removed in T10):
```env
# Database (Postgres — being replaced by Cortex)
DATABASE_URL=postgresql://user:password@host:5432/database
# DATABASE_SSL=true
# DATABASE_SSL_REJECT_UNAUTHORIZED=false

# Cortex
CORTEX_HTTP=http://localhost:9091
CORTEX_DATA_DIR=./data/cortex
CORTEX_AUTOSTART=true
CORTEX_TIMEOUT_MS=2000

# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# X (Twitter)
X_PROFILE_HANDLE=your_x_handle
ECHO_X_LIST_URL=https://x.com/i/lists/YOUR_LIST_ID
ECHO_X_PROFILE_URL=https://x.com/YOUR_HANDLE
ECHO_KEYWORDS=AI agents,developer tools,startup growth,indie hacking,LLM

# Browser (optional)
# BROWSER=chrome
# HEADLESS=false

# Anti-detection delays in ms (optional)
# XBOT_DELAY_BEFORE_ACTION=500
# XBOT_DELAY_AFTER_ACTION=300
# XBOT_DELAY_TYPING=80
# XBOT_DELAY_JITTER=200
# XBOT_SESSION_FILE=./session.json
```

**`cortex.toml`** — new file at repo root:
```toml
[server]
grpc_addr = "0.0.0.0:9090"
http_addr = "0.0.0.0:9091"
data_dir = "./data/cortex"

[auto_linker]
enabled = true
interval_secs = 300
similarity_threshold = 0.82
max_edges_per_node = 20

[score_decay]
half_life_days = 30
```

**`docker-compose.yml`** — new file at repo root:
```yaml
services:
  cortex:
    image: mikesquared/cortex:latest
    restart: unless-stopped
    ports:
      - "9090:9090"
      - "9091:9091"
    volumes:
      - ./data/cortex:/data
    command: serve --data-dir /data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**`.gitignore`** — add:
```
data/cortex/
```

**`README.md`** — update Prerequisites section to add:
```markdown
## Prerequisites

- Node.js >= 18
- **Cortex** — graph memory engine:
  ```bash
  curl -sSf https://raw.githubusercontent.com/MikeSquared-Agency/cortex/main/install.sh | sh
  ```
  First run downloads the embedding model (~150MB, 1–2 min).

## Setup

1. Clone the repo
2. `cp .env.example .env` and fill in API keys
3. `cd xbot-browser && npm install`
4. Cortex starts automatically when xbot-browser starts (`CORTEX_AUTOSTART=true`)
   - Or start manually: `cortex serve`
   - Inspect the graph: http://localhost:9091/viz
```

### Acceptance criteria

- `.env.example` preserves ALL existing variables
- `cortex.toml` is valid TOML
- `data/cortex/` added to `.gitignore`

---

## T5 — CortexStore Implementation

**Wave:** 2 (serial)
**Depends on:** T1 (skeleton), T2 (ToolIndex)
**Blocks:** T6, T7, T8, T9
**Estimated effort:** 4–5h

### Context

This is the main implementation. `CortexStore` replaces `ActionStore` by implementing every method against the Cortex HTTP API. The trickiest parts are:

1. **Encoding structured data**: Cortex HTTP API has no `metadata` field — store `input_schema`, `execution`, etc. as JSON in the `body` field
2. **Upsert via ToolIndex**: Check if node exists before creating; supersede old nodes
3. **Mapping configs → domain nodes and tools → tool nodes**
4. **Bypassing write gate**: Use `?gate=skip` + `x-gate-override: true` for all writes
5. **Graceful degradation**: All read methods return empty/null (never throw) when Cortex is down

### File to implement

`xbot-browser/src/cortex/cortex-store.js`

### Node encoding scheme

**Domain node (replaces `configs` row):**
```javascript
{
  kind: 'domain',
  title: domain,                          // e.g., 'amazon.com'
  body: JSON.stringify({
    url_pattern: urlPattern,              // e.g., '/*'
    description: description,
    tags: tags,
    visit_count: 0,
  }),
  importance: 0.5,
  tags: [domain, urlPattern],
  source_agent: 'xbot',
}
```

**Tool node (replaces `tools` row):**
```javascript
{
  kind: 'tool',
  title: name,                            // e.g., 'search-products'
  body: JSON.stringify({
    description: description,
    input_schema: inputSchema,            // array of { name, type, description, required, default }
    execution: execution,                 // { fields, submit, waitFor, resultSelector, ... }
    domain: domain,
    url_pattern: urlPattern,
    failure_count: 0,
    fallback_selectors: null,
  }),
  importance: 0.75,
  tags: [domain, name],
  source_agent: 'xbot',
}
```

### Decoding: Cortex node → config-like / tool-like object

```javascript
/** Convert a Cortex domain node into a config-like object */
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

/** Convert a Cortex tool node into a tool-like object, with optional config context */
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

function parseBody(body) {
  try { return JSON.parse(body); }
  catch { return {}; }
}
```

### HTTP helpers

```javascript
/** POST with write gate bypass. Returns response data or null on failure. */
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

/** GET with graceful degradation. Returns response data or fallback. */
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

/** PATCH node. Returns response data or null. */
async _patch(nodeId, body) {
  try {
    const res = await fetch(`${this._httpBase}/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-agent-id': this._sourceAgent },
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
```

### Key method implementations

**createConfig:**
```javascript
async createConfig({ domain, urlPattern, title, description, tags }) {
  const pattern = urlPattern || '/*';

  // Check ToolIndex for existing
  const existingId = this._toolIndex.get(configKey(domain, pattern));
  if (existingId) {
    const existing = await this._get(`/nodes/${existingId}`);
    if (existing) return nodeToConfig(existing);
  }

  const node = await this._post('/nodes', {
    kind: 'domain',
    title: domain,
    body: JSON.stringify({ url_pattern: pattern, description: description || '', tags: tags || null, visit_count: 0 }),
    importance: 0.5,
    tags: [domain, pattern],
    source_agent: this._sourceAgent,
  });

  if (!node) throw new Error('Failed to create config in Cortex');

  this._toolIndex.set(configKey(domain, pattern), node.id);
  return nodeToConfig({ ...node, title: domain, body: JSON.stringify({ url_pattern: pattern, description: description || '', tags: tags || null, visit_count: 0 }) });
}
```

**addTool:**
```javascript
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
```

**findToolsForUrl (critical path — called on every navigation):**
```javascript
async findToolsForUrl(domain, url) {
  // Get all domain nodes for this domain
  const domainNodes = await this._get(`/nodes?kind=domain&tag=${encodeURIComponent(domain)}&limit=50`, []);
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
    .map(n => ({ node: n, ...parseBody(n.body) }))
    .filter(c => matchUrlPattern(c.url_pattern || '/*', pathname));

  if (matchingConfigs.length === 0) return [];

  // Get tool neighbors for each matching config
  const tools = [];
  for (const config of matchingConfigs) {
    const neighbors = await this._get(`/nodes/${config.node.id}/neighbors?depth=1&direction=outgoing`, []);
    if (!Array.isArray(neighbors)) continue;

    for (const neighbor of neighbors) {
      // Cortex neighbor response includes node data — filter for tool kind
      const node = neighbor.node || neighbor;
      if (node.kind?.toLowerCase() === 'tool') {
        tools.push(nodeToTool(node, config.node));
      }
    }
  }

  return tools;
}
```

**searchConfigsByQuery (semantic search):**
```javascript
async searchConfigsByQuery(query, limit = 1) {
  // Use Cortex vector search scoped to domain nodes
  const results = await this._get(
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    []
  );

  if (!Array.isArray(results)) return [];

  const configs = [];
  for (const result of results) {
    const node = result.node || result;
    if (node.kind?.toLowerCase() !== 'domain') continue;

    const config = nodeToConfig(node);

    // Get tools for this config
    const neighbors = await this._get(`/nodes/${node.id}/neighbors?depth=1&direction=outgoing`, []);
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
```

**incrementFailureCount / resetFailureCount:**
```javascript
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
```

### Acceptance criteria

- All methods from T1 skeleton implemented
- `findToolsForUrl` returns `[]` when Cortex is down (not throws)
- `searchConfigsByQuery` returns `[]` when Cortex is down (not throws)
- ToolIndex updated on every create/delete
- Write gate bypassed on all POST /nodes calls
- `addTool` with same domain+name supersedes old node (decay + supersedes edge)
- Return objects match the shapes callers expect (verified by running existing tool registry code)

---

## T6 — XbotBackend Integration

**Wave:** 3 (parallel)
**Depends on:** T5
**Blocks:** T9, T10
**Estimated effort:** 1–2h

### Context

Swap `ActionStore` for `CortexStore` in `XbotBackend`. The constructor initialises the store. Since `CortexStore` has the same interface, the only changes are:
1. Constructor: create `CortexStore` instead of `ActionStore`
2. Startup: call `ensureCortexRunning()` before first use
3. Remove `pg` dependency from `package.json`

### Files to modify

**`xbot-browser/src/xbot-backend.js`:**

```javascript
// Replace:
const { ActionStore, extractDomain } = require('./action-store');

// With:
const { CortexStore } = require('./cortex/cortex-store');
const { ensureCortexRunning } = require('./cortex/cortex-process');
const { extractDomain } = require('./action-store');  // keep extractDomain helper

// In constructor:
// Replace:
this._store = new ActionStore();

// With:
this._store = new CortexStore({
  httpBase: process.env.CORTEX_HTTP || 'http://localhost:9091',
  timeoutMs: parseInt(process.env.CORTEX_TIMEOUT_MS || '2000', 10),
});
```

**`xbot-backend.js` — add Cortex startup to `initialize()`:**

```javascript
async initialize(clientInfo) {
  // Start Cortex if configured
  await ensureCortexRunning({
    httpBase: process.env.CORTEX_HTTP || 'http://localhost:9091',
    dataDir: process.env.CORTEX_DATA_DIR || './data/cortex',
    configPath: './cortex.toml',
    autostart: process.env.CORTEX_AUTOSTART !== 'false',
  });

  await this._inner.initialize(clientInfo);
}
```

**Note:** `extractDomain` is a small utility function (4 lines). It should be extracted from `action-store.js` into a shared util, or kept imported from action-store.js during transition. In T10 when action-store.js is deleted, move it into cortex-store.js or a utils file.

### Acceptance criteria

- XbotBackend uses CortexStore instead of ActionStore
- Cortex autostart happens during `initialize()`
- All existing tool operations (navigate, execute, add, update, delete, memory search) work unchanged
- `extractDomain` still works

---

## T7 — Cortex Briefing Injection

**Wave:** 3 (parallel)
**Depends on:** T5
**Blocks:** T9
**Estimated effort:** 1h

### Context

When navigating to a domain that has stored knowledge, inject a Cortex briefing into the navigation response. This gives the LLM domain context beyond just the tool list. The briefing is fetched from `GET /briefing/xbot` filtered to relevant content.

### File to modify

**`xbot-browser/src/xbot-backend.js` — add to `_handleNavigate()`, after tool lookup:**

After the existing tool lookup logic (lines 118–126 in current code), add briefing injection:

```javascript
// After: await this._registry.lookupToolsForUrl(requestedUrl);
// ... (existing redirect detection logic) ...

// NEW: Inject Cortex domain briefing if available
if (this._registry.currentDomain && this._registry.currentTools.length > 0) {
  try {
    const briefingUrl = `${this._store._httpBase || 'http://localhost:9091'}/briefing/xbot?compact=true`;
    const res = await fetch(briefingUrl, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (res?.ok) {
      const json = await res.json();
      if (json.success && json.data?.rendered) {
        const briefing = postProcessBriefing(json.data.rendered, 600);
        if (briefing) {
          // Inject as context before the tool list
          const briefingBlock = `<domain-memory domain="${this._registry.currentDomain}">\n${briefing}\n</domain-memory>\n\n`;
          result = prependTextToResult(result, briefingBlock);
        }
      }
    }
  } catch {}
}
```

**Add helper function:**

```javascript
function postProcessBriefing(raw, maxTokens) {
  if (!raw) return '';
  const charLimit = maxTokens * 4;
  const stripped = raw.replace(/[#*`_~[\]]/g, '').trim();
  if (stripped.length === 0) return '';
  return stripped.length > charLimit
    ? stripped.slice(0, charLimit) + '... [truncated]'
    : stripped;
}
```

### Acceptance criteria

- Briefing injection is skipped when no tools exist for domain
- Briefing failure (Cortex down, timeout) is silently caught
- Briefing is markdown-stripped and truncated
- Existing navigation behavior unchanged when briefing is empty

---

## T8 — Feedback Hooks (Importance Adjustment)

**Wave:** 3 (parallel)
**Depends on:** T5
**Blocks:** T9
**Estimated effort:** 1h

### Context

When a stored tool executes successfully, boost its Cortex node importance. When it fails (selector failure), decrease importance. This replaces the spec's original reinforce/decay concept, adapted to use `PATCH /nodes/:id` with updated `importance` values.

The existing `failure_count` / `resetFailureCount` mechanism already works (T5 implements it). This task adds importance-based feedback on top.

### File to modify

**`xbot-browser/src/xbot-backend.js` — in `_handleExecute()`:**

After successful execution (around line 393 in current code, where `resetFailureCount` is called):

```javascript
// Existing: success after previous failures — reset
} else if (!result.isError && tool.id && tool.failure_count > 0) {
  await this._store.resetFailureCount(tool.id);
}

// NEW: Fire-and-forget importance boost on success
if (!result.isError && tool.id) {
  this._boostImportance(tool.id, 0.05);
}
```

After all fallbacks failed (around line 388, after `incrementFailureCount`):

```javascript
if (tool.id) {
  const newCount = await this._store.incrementFailureCount(tool.id);
  // NEW: Decay importance on repeated failure
  if (newCount >= 2) {
    this._boostImportance(tool.id, -0.1);
  }
  // ... existing relearn-nudge logic ...
}
```

**Add helper method to XbotBackend class:**

```javascript
/**
 * Fire-and-forget importance adjustment via Cortex PATCH.
 * Positive delta = boost, negative = decay. Clamps to [0.1, 1.0].
 */
_boostImportance(nodeId, delta) {
  const httpBase = process.env.CORTEX_HTTP || 'http://localhost:9091';
  // Get current importance, then adjust
  fetch(`${httpBase}/nodes/${nodeId}`, { signal: AbortSignal.timeout(2000) })
    .then(res => res.ok ? res.json() : null)
    .then(json => {
      if (!json?.success) return;
      const current = json.data.importance || 0.5;
      const adjusted = Math.max(0.1, Math.min(1.0, current + delta));
      return fetch(`${httpBase}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: adjusted }),
        signal: AbortSignal.timeout(2000),
      });
    })
    .catch(() => {}); // intentionally swallowed — fire-and-forget
}
```

### Acceptance criteria

- `_boostImportance` is truly fire-and-forget (no `await`, swallows errors)
- Importance clamped to [0.1, 1.0]
- Success: +0.05 per execution
- Failure (≥2 consecutive): -0.1 per failure
- Does not interfere with existing failure_count tracking

---

## T9 — Unit Tests

**Wave:** 4 (parallel with T10)
**Depends on:** T5, T6, T7, T8
**Blocks:** nothing
**Estimated effort:** 3h

### Context

Tests run against a real `cortex serve` instance (started in setup). Do not mock the HTTP layer — test the actual Cortex round-trip to validate HTTP endpoint assumptions.

### Test files

**`xbot-browser/tests/cortex/tool-index.test.js`:**
- set → get → returns correct nodeId
- get unknown → returns null
- new ToolIndex instance (same dataDir) → get still works (persistence)
- clear → get → returns null
- configKey / toolKey helpers produce correct strings

**`xbot-browser/tests/cortex/cortex-store.test.js`:**

Setup:
```javascript
const { execSync, spawn } = require('child_process');
const { CortexStore } = require('../../src/cortex/cortex-store');
const TEST_DATA_DIR = './data/cortex-test';
const TEST_PORT = 19091;

let store;
let cortexProcess;

beforeAll(async () => {
  // Start real Cortex on test port
  cortexProcess = spawn('cortex', [
    'serve', '--data-dir', TEST_DATA_DIR, '--http-port', String(TEST_PORT)
  ], { stdio: 'ignore' });

  // Wait for health
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  store = new CortexStore({
    httpBase: `http://localhost:${TEST_PORT}`,
    toolIndexDir: TEST_DATA_DIR,
  });
}, 35_000);

afterAll(() => {
  try { cortexProcess.kill(); } catch {}
  const fs = require('fs');
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});
```

Required test cases:

| Test | What it verifies |
|---|---|
| `createConfig creates domain node` | Returns config-like object with id, domain, url_pattern |
| `getConfigsForDomain returns created configs` | After createConfig, getConfigsForDomain finds it |
| `getConfigForDomainAndPattern returns exact match` | Filters by url_pattern |
| `addTool creates tool node with edge` | Returns tool-like object; findToolsForUrl returns it |
| `addTool with same name supersedes` | Second addTool → one active tool, old has low importance |
| `findToolsForUrl returns empty for unknown domain` | No error, empty array |
| `findToolsForUrl matches URL patterns` | Pattern `/*` matches everything, `/dp/*` matches `/dp/123` |
| `updateTool updates tool fields` | Change description, verify |
| `deleteTool removes tool` | After delete, findToolByName returns null |
| `incrementFailureCount increments` | Count goes 0 → 1 → 2 |
| `resetFailureCount resets to 0` | After increment, reset → 0 |
| `searchConfigsByQuery returns semantic matches` | Create config "Amazon shopping", search "buy products" |
| `findToolByName finds globally` | Finds tool without specifying domain |
| `findToolByNameForDomain scopes to domain` | Only finds tool on correct domain |
| `CortexStore degrades gracefully when down` | Stop Cortex, findToolsForUrl returns [], no throw |

**`xbot-browser/tests/cortex/cortex-process.test.js`:**
- `ensureCortexRunning` succeeds when Cortex already running
- `ensureCortexRunning` with autostart=false does nothing
- `CortexStartupError` thrown on bad binary

### Acceptance criteria

- All tests pass against real `cortex serve`
- Test suite completes in < 90 seconds
- Each test uses unique domain names (no cross-test pollution)
- Graceful degradation test verifies no-throw behavior

---

## T10 — Integration Tests + Postgres Removal

**Wave:** 4 (parallel with T9)
**Depends on:** T6
**Blocks:** nothing (finish line)
**Estimated effort:** 2–3h

### Part A — Integration test

File: `xbot-browser/tests/integration/full-navigation.test.js`

Uses Playwright test framework (already in devDependencies). Tests the full XbotBackend flow.

| Scenario | Steps | Pass condition |
|---|---|---|
| Cold start — no tools | Navigate to `example.com` | Response says "No saved tools for example.com" |
| Create config + add tool | Call `add_create-config`, then `add_tool` | Returns success with configId and toolId |
| Warm visit — tools loaded | Navigate to `example.com` again | Response includes `<available-tools>` with saved tool |
| Execute saved tool | Call `xbot_execute` with saved tool | Translator runs, result returned |
| Tool failure → fallback | Execute tool where selector fails | Failure count incremented, relearn nudge after 3 |
| Memory search | Call `xbot_memory` with query | Returns matching config |

### Part B — Postgres removal

Execute in order:

```bash
# 1. Remove Postgres npm deps
cd xbot-browser
npm uninstall pg

# 2. Keep action-store.js but gut the Postgres code
# Move extractDomain + matchUrlPattern to a shared utils file
# Delete the ActionStore class and Pool import

# 3. Archive supabase (do not delete — preserve migration history)
git mv supabase/ supabase-archived/

# 4. Update .env.example — remove DATABASE_URL and DATABASE_SSL lines

# 5. Remove Postgres references from README

# 6. Verify no Postgres references remain in active code:
grep -r "pg\|postgres\|DATABASE_URL\|Pool" xbot-browser/src/
# Should return zero results

# 7. Run full test suite
cd xbot-browser && npm test
```

### Part C — Extract shared utilities

Create `xbot-browser/src/utils.js` with the helpers that both old and new code use:

```javascript
'use strict';

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
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

module.exports = { extractDomain, matchUrlPattern };
```

### Acceptance criteria

- `npm test` passes with zero Postgres references in `xbot-browser/src/`
- Integration tests pass end-to-end
- `extractDomain` and `matchUrlPattern` preserved in utils.js
- supabase/ archived (not deleted)
- No `pg` in package.json dependencies
- `localhost:9091/viz` shows correct graph structure after tests

---

## Summary Table

| Task | Wave | Depends on | Effort |
|---|---|---|---|
| T1: CortexStore skeleton | 0 | nothing | 1–2h |
| T2: ToolIndex | 1 | nothing | 30min |
| T3: cortex-process.js | 1 | nothing | 1h |
| T4: Config & infra | 1 | nothing | 1h |
| T5: CortexStore implementation | 2 | T1, T2 | 4–5h |
| T6: XbotBackend integration | 3 | T5 | 1–2h |
| T7: Cortex briefing injection | 3 | T5 | 1h |
| T8: Feedback hooks | 3 | T5 | 1h |
| T9: Unit tests | 4 | T5, T6, T7, T8 | 3h |
| T10: Integration + Postgres removal | 4 | T6 | 2–3h |

**Critical path:** T1 → T5 → T6 → T10
**Total serial:** ~16h
**With parallelisation:** ~10h wall-clock
