# CLAUDE.md — Agent Instructions for Xbot

## Project Overview

Xbot is an MCP server for browser automation that learns and reuses procedures. It has two main components:

1. **xbot-browser** (Node.js) — MCP server built on Playwright with stored tools, graph memory (Cortex), and anti-detection
2. **echo** (Python) — Tweet discovery and engagement system that uses xbot-browser as an MCP client

## MCP Tool Catalog

These are the tools an MCP client can call on xbot-browser. All tools communicate via stdio JSON-RPC (MCP protocol).

### Browser Tools

| Tool | Type | Description |
|------|------|-------------|
| `browser_navigate` | action | Navigate to a URL. Returns page info + any saved tools for the site. |
| `browser_snapshot` | readOnly | Capture accessibility snapshot of the current page. Returns element refs (`e12`, `e37`) used by fallback tools. |
| `browser_fallback` | action | Gateway to raw Playwright tools (`browser_click`, `browser_type`, `browser_fill_form`, etc.). Use `peek: true` to inspect a tool's schema. All element-targeting uses `ref` values from `browser_snapshot`, NOT CSS selectors. |

### Saved Tool Tools

| Tool | Type | Description |
|------|------|-------------|
| `xbot_execute` | action | Run a saved tool by name. Args: `{ toolName, args }`. Tools are domain-specific — navigate first. |
| `xbot_memory` | readOnly | Semantic search across all saved sites/tools. Args: `{ query }`. |
| `add_create-config` | action | Create a config (site definition). Args: `{ domain, urlPattern, title, description, tags }`. Returns `configId`. |
| `add_tool` | action | Add a tool to a config. Args: `{ configId, name, description, inputSchema (JSON string), execution (JSON string) }`. |
| `add_update-tool` | action | Update an existing tool. Args: `{ toolName, domain?, newName?, description?, inputSchema?, execution? }`. |
| `add_delete-tool` | action | Delete a tool. Args: `{ toolName, domain? }`. |

### X (Twitter) Tools

| Tool | Type | Description |
|------|------|-------------|
| `x:check-session` | readOnly | Check if X session is authenticated. Returns `{ authenticated, url, title }`. |
| `x:pull-analytics` | readOnly | Pull X Analytics CSV. Navigates to analytics content tab, downloads CSV, returns raw text. Args: `{ days? }` (default 1). |

### How to Use the Browser MCP

**Basic workflow:**
1. Call `browser_navigate({ url })` — opens the page, shows available saved tools
2. If saved tools exist → use `xbot_execute({ toolName, args })` to run them
3. If no saved tool → use `browser_snapshot` to see the page, then `browser_fallback` for raw Playwright actions
4. After completing a task with fallback → save it with `add_create-config` + `add_tool`

**Building a saved tool — full example:**
```
1. browser_navigate({ url: "https://example.com" })
2. browser_snapshot({})                           → get element refs
3. browser_fallback({ tool: "browser_click", arguments: { ref: "e12" } })
4. add_create-config({ domain: "example.com", title: "Example Site" })
   → returns configId
5. add_tool({
     configId: "...",
     name: "search-products",
     description: "Search by keyword",
     inputSchema: '[{ "name": "query", "type": "string", "required": true }]',
     execution: '{ "fields": [{ "selector": "#search", "param": "query" }], "submit": { "selector": "#go" }, "waitFor": ".results", "resultSelector": ".item", "resultType": "list" }'
   })
```

**Execution definition shape:**
```json
{
  "fields": [{ "selector": "#input", "param": "query", "type": "fill" }],
  "submit": { "selector": "#btn" },
  "waitFor": ".results",
  "resultSelector": ".item",
  "resultType": "list",
  "resultExtract": "text",
  "delays": { "preSubmit": 500, "postSubmit": 1000 }
}
```

**resultExtract modes:** `text` (default), `list`, `html`, `attribute`, `table`, `innerText`, `innerTextList`

**Field types:** `fill` (default), `select`, `check`, `radio`, `click`

## Cortex Graph Memory

### HTTP API (port 9091)

Base URL: `http://localhost:9091` (no `/v1/` prefix)

All responses: `{ success: bool, data: ..., error: ... }`

**Write gate bypass** (required for writes): `?gate=skip` query param + `x-gate-override: true` header

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/nodes` | Create a node |
| `GET` | `/nodes?kind=X&tag=Y&limit=N` | List nodes (filter by kind, tag) |
| `GET` | `/nodes/:id` | Get single node |
| `PATCH` | `/nodes/:id` | Update node (body, tags, importance) |
| `DELETE` | `/nodes/:id` | Delete node |
| `POST` | `/edges` | Create edge: `{ from_id, to_id, relation, weight }` |
| `GET` | `/nodes/:id/neighbors` | Get connected nodes |
| `POST` | `/search` | Semantic search: `{ query, limit }` |
| `GET` | `/health` | Health check |
| `GET` | `/briefing/:agent_id` | Get agent briefing |

#### Node Shape

```json
{
  "kind": "post",
  "title": "unique-identifier",
  "body": "{\"key\": \"value\"}",
  "tags": ["tag1", "tag2"],
  "source_agent": "echo",
  "importance": 0.5
}
```

- `kind` in requests: lowercase (`"post"`, `"tweet"`, `"reply"`)
- `kind` in responses: PascalCase (`"Post"`, `"Tweet"`) — compare case-insensitively
- `body`: always a JSON string (not object) — `JSON.stringify()` before sending
- `relation` on edges: lowercase + underscores only (`"has_tool"`, `"reply_to"`)
- No reinforce/decay endpoints — use `PATCH /nodes/:id` with `{ importance: newValue }`

#### Create Node Example (curl)

```bash
curl -X POST 'http://localhost:9091/nodes?gate=skip' \
  -H 'Content-Type: application/json' \
  -H 'x-agent-id: echo' \
  -H 'x-gate-override: true' \
  -d '{"kind":"post","title":"123456","body":"{\"text\":\"hello\",\"impressions\":5}","source_agent":"echo","importance":0.5,"tags":["post","pid-123456"]}'
```

### Data Model — All Node Kinds

#### xbot-browser nodes

| Kind | Title | Tags | Body fields | Purpose |
|------|-------|------|-------------|---------|
| `domain` | domain name | `["domain"]` | `url_pattern, title, description, tags` | Site config |
| `tool` | tool name | `["tool"]` | `name, description, input_schema, execution, failure_count, fallback_selectors` | Saved browser tool |

Edges: `domain → tool` with `relation=has_tool`

#### echo nodes

| Kind | Title | Tags | Body fields | Purpose |
|------|-------|------|-------------|---------|
| `tweet` | tweet_id | `["tweet", "status-queued", "tid-{id}", "author-{handle}"]` | `content, author_handle, tweet_url, virality_score, discovered_at, tweet_created_at` | Discovered tweet |
| `reply` | `reply-{tweet_id}-{ts}` | `["reply", "tweet-{id}", "strategy-{s}"]` | `tweet_id, reply_text, strategy, posted_at, impressions, likes, reply_id` | Echo-generated reply |
| `post` | post_id | `["post", "pid-{id}", "is-reply"?, "has-url"?]` | `text, impressions, likes, retweets, engagements, bookmarks, posted_at, post_url` | Analytics data (any post/reply from the account) |
| `daily_digest` | date string | `["daily-digest"]` | `digest_json, total_replies, avg_score` | Daily performance digest |
| `strategy_score` | `{date}-{strategy}` | `["strategy-score", "strategy-{s}"]` | `date, strategy, total, wins, win_rate` | Strategy effectiveness |

Edges: `reply → tweet` with `relation=reply_to`, `author → tweet` with `relation=authored`

### Accessing Cortex from Python (echo)

**Client:** `echo/db/cortex.py` → `CortexClient` class

```python
from echo.db.cortex import CortexClient

c = CortexClient(base_url="http://localhost:9091", source_agent="echo")
node = await c.create_node(kind="post", title="123", body={"text": "hi"}, tags=["post"])
nodes = await c.get_nodes(kind="post", tag="pid-123", limit=10)
await c.update_node(node_id, body={"text": "updated"})
```

**Store:** `echo/db/store.py` → `EchoStore` class (higher-level, wraps CortexClient)

```python
from echo.db.store import EchoStore
store = await EchoStore.connect()

# Tweets
await store.insert_tweets([{...}])
await store.get_queued_tweets()

# Replies
await store.insert_reply({"tweet_id": "...", "reply_text": "...", "strategy": "..."})
await store.find_reply_by_reply_id("123")
await store.update_reply_metrics(node_id, {"impressions": 100, "likes": 5})

# Post analytics (from X Analytics CSV)
await store.upsert_post_analytics("post_id", {"text": "...", "impressions": 100})
await store.find_post_by_id("post_id")
```

### Accessing Cortex from JavaScript (xbot-browser)

**Client:** `xbot-browser/src/cortex/cortex-store.js` → `CortexStore` class

```javascript
const { CortexStore } = require('./cortex/cortex-store');
const store = new CortexStore({ httpBase: 'http://localhost:9091' });

// Configs (site definitions)
const config = await store.createConfig({ domain, urlPattern, title });
const config = await store.getConfigForDomainAndPattern(domain, pattern);

// Tools
const tool = await store.addTool({ configId, name, description, inputSchema, execution });
const tool = await store.findToolByNameForDomain(domain, toolName);
await store.updateTool(toolId, { execution: newExecution });
```

## Connecting to xbot-browser as an MCP Client (Python)

Use the official MCP SDK — not raw JSON-RPC. See `echo/xbot_process.py` for the production client.

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="node",
    args=["/path/to/xbot-browser/cli.js", "--browser", "chrome"],
    env={**os.environ},
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()

        # Call any MCP tool
        result = await session.call_tool("browser_navigate", {"url": "https://example.com"})
        result = await session.call_tool("x:pull-analytics", {"days": 7})

        # Result has .content list — extract text
        for item in result.content:
            if hasattr(item, "text"):
                print(item.text)
```

**Important:** `echo/xbot_process.py` wraps this as `XbotProcess` with long-lived session management. For one-shot scripts, use `stdio_client` directly (as in `echo/voice/bootstrap.py`).

## Critical Architecture

### Main Orchestrator

`xbot-browser/src/xbot-backend.js` — **XbotBackend class**. This is the central file. It:
- Wraps Playwright's BrowserServerBackend
- Registers all MCP tools in `listTools()`
- Dispatches tool calls in `callTool()` via switch statement
- Handles navigation with multi-stage URL resolution (server redirect, SPA redirect)
- Manages tool execution with selector resilience (fallback selectors, failure counting)

### Tool Execution Pipeline

```
Tool definition (from Cortex) → action-translator.js → Playwright code string → browser_run_code
```

The `execution` field on tools is a rich JSON object: `{ fields, submit, waitFor, resultSelector, resultType, resultExtract, delays, scrolls, verifySelector }`. The translator generates async Playwright code that runs in the browser context.

**Important:** `browser_run_code` runs in the browser context (like `page.evaluate`). You CANNOT use `require('fs')` or Node.js APIs inside it. To read files from disk, return a path from `browser_run_code` and read it in the outer Node.js handler with `fs`.

### Selector Types

Selectors can be:
- Plain CSS strings: `"#search-box"`
- Playwright-specific strings: `"role=button"`, `":has-text(Submit)"`
- Structured objects: `{ css, role, name, text, testId, label, placeholder, hasText, nth }`

The translator auto-detects which type and uses either `page.evaluate()` (DOM, faster) or `page.locator()` (Playwright API, more powerful).

## File Map

### xbot-browser/src/ (all JavaScript, CommonJS)

| File | Purpose | Key exports |
|------|---------|-------------|
| `xbot-backend.js` | Main MCP orchestrator | `XbotBackend` |
| `action-translator.js` | Tool → Playwright code | `translateAction` |
| `action-tools.js` | MCP tool schemas (Zod) | `xbotExecuteSchema`, `xPullAnalyticsSchema`, etc. |
| `action-schema.js` | Validation schemas | Zod schemas for params, fields, execution |
| `cortex/cortex-store.js` | Cortex storage layer | `CortexStore` |
| `cortex/cortex-process.js` | Cortex autostart | `ensureCortexRunning` |
| `cortex/tool-index.js` | Local upsert index | `ToolIndex`, `configKey`, `toolKey` |
| `tools/registry.js` | Tool lookup for current page | `ToolRegistry` |
| `tools/fallback.js` | Fallback tracking + save nudges | `FallbackTracker` |
| `tools/x-tools.js` | X tools | `handleCheckSession`, `handlePullAnalytics` |
| `browser/session.js` | Browser state save/load | `saveSession`, `loadSession` |
| `browser/anti-detection.js` | Delay/jitter helpers | `resolveDelays`, `generateDelayCode` |

### echo/ (Python)

| File | Purpose |
|------|---------|
| `orchestrator.py` | Main loop, poll cycle, evolve scheduler, analytics pull |
| `xbot_process.py` | MCP client (wraps `stdio_client` + `ClientSession`) |
| `db/cortex.py` | Low-level Cortex HTTP client |
| `db/store.py` | High-level data store (EchoStore) |
| `db/models.py` | Dataclasses: Tweet, Candidate, GeneratedReply |
| `analytics/csv_import.py` | X Analytics CSV parser + Cortex import |
| `cli/app.py` | Interactive CLI (EchoCLI) |
| `scout/` | Tweet discovery |
| `compose/` | Reply generation (Anthropic API) |
| `voice/` | Voice profile analysis |

## Conventions

- **Language:** JavaScript (CommonJS `require`/`module.exports`), NOT TypeScript
- **Style:** No semicolons in some files, semicolons in others — follow the style of the file you're editing
- **Tool naming:** kebab-case verb-noun (`search-products`, `fill-login`, `extract-price`)
- **X tools:** prefixed with `x:` (`x:check-session`, `x:pull-analytics`)
- **MCP tool schemas:** defined using Zod via `playwright-core/lib/mcpBundle`
- **Tests:** Playwright test framework (`@playwright/test`)
- **No TypeScript compilation** — source files are plain .js, only type declarations (`.d.ts`) exist
- **Cortex node IDs in Python:** always use `str` dtype when reading CSV tweet/post IDs (pandas will convert large ints to float scientific notation otherwise)

## Common Tasks

### Adding a new MCP tool

1. Define schema in `action-tools.js` (Zod)
2. Add to `listTools()` array in `xbot-backend.js`
3. Add case to `callTool()` switch in `xbot-backend.js`
4. Implement handler — either as `_handleXxx()` method on XbotBackend, or in a separate file (e.g., `tools/x-tools.js`) and import

### Building a saved browser tool for a site

1. Navigate to the site: `browser_navigate({ url })`
2. Take a snapshot: `browser_snapshot({})` — learn the page structure
3. Interact using `browser_fallback` with `ref` values from the snapshot
4. Create a config: `add_create-config({ domain, title })`
5. Save the tool: `add_tool({ configId, name, inputSchema, execution })`
6. Test it: `xbot_execute({ toolName, args })`

### Storing data in Cortex from echo (Python)

```python
# Use EchoStore for high-level operations
store = await EchoStore.connect()
await store.upsert_post_analytics("post_id", {"text": "...", "impressions": 100})

# Or use CortexClient for low-level node/edge operations
from echo.db.cortex import CortexClient
c = CortexClient()
await c.create_node(kind="my_kind", title="unique-id", body={"data": "here"}, tags=["my_kind"])
```

### Running Echo

```bash
cd /path/to/Xbot
source echo/.venv/bin/activate
export X_PROFILE_HANDLE="YourHandle"
python3 run_echo.py
```

CLI commands during run: `analytics [days]`, `status`, `history`, `digest`, `s` (skip), `q` (quit)

### Running tests

```bash
cd xbot-browser
npm test                    # all tests
npm run ctest               # chrome only
npx playwright test tests/cortex/  # cortex tests only
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORTEX_HTTP` | no | `http://localhost:9091` | Cortex HTTP endpoint |
| `CORTEX_DATA_DIR` | no | `./data/cortex` | Cortex data directory |
| `CORTEX_AUTOSTART` | no | `true` | Auto-start Cortex binary |
| `CORTEX_TIMEOUT_MS` | no | `2000` | HTTP timeout for Cortex |
| `ANTHROPIC_API_KEY` | for echo | — | Anthropic API key |
| `X_PROFILE_HANDLE` | for echo | — | X handle for echo |

## Do NOT

- Convert files to TypeScript — the project is JavaScript
- Add `pg` or PostgreSQL dependencies — the project uses Cortex
- Change the MCP tool interface (tool names, argument shapes) without updating action-tools.js schemas
- Use `/v1/` prefix on Cortex HTTP calls
- Use `kind` field on edge creation (it's `relation`)
- Assume Cortex has reinforce/decay endpoints (it doesn't)
- Modify `action-translator.js` selector detection logic without understanding both DOM and Playwright code paths
- Use `require()` or Node.js APIs inside `browser_run_code` — it runs in browser context
- Read pandas tweet/post IDs without `dtype=str` — large IDs become float scientific notation
- Use raw JSON-RPC to talk to xbot-browser — use the MCP SDK (`stdio_client` + `ClientSession`)
- Print to `console.log`/`console.info` in xbot-browser server code — it corrupts the MCP stdio stream. Use `console.error` (stderr) for logging.
