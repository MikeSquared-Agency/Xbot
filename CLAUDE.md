# CLAUDE.md — Agent Instructions for Xbot

## Project Overview

Xbot is an MCP server for browser automation that learns and reuses procedures. The agent drives all workflows directly using skills and browser tools — no Python orchestrator, no separate API calls.

**xbot-browser** (Node.js) — MCP server built on Playwright with stored tools, graph memory (Cortex), and anti-detection.

**skills/** — Agent skill files that define multi-step workflows (tweet research, reply composition, analytics ingestion).

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

All accessed via `xbot_execute({ toolName, args })`. Defined in `seeds/tools.json`, stored in Cortex.

| Tool | Args | Returns |
|------|------|---------|
| `x:check-session` | none | `{ authenticated, url, title }` |
| `x:pull-analytics` | `{ days? }` (default 1) | Raw CSV text with per-post metrics |
| `x:get-list-feed` | `{ list_url }` | Array of `{ text, url }` per tweet |
| `x:search-tweets` | `{ query, tab? }` (tab: latest/top) | Array of `{ text, url }` per tweet |
| `x:get-author-profile` | `{ handle }` | `{ userName, bio, headerItems, followers, following, url }` |
| `x:get-author-timeline` | `{ handle, count? }` | Array of tweet innerText strings |
| `x:post-reply` | `{ tweet_url, reply_text }` | `{ success, url }` |

### How to Use the Browser MCP

**Basic workflow:**
1. Call `browser_navigate({ url })` — opens the page, shows available saved tools
2. If saved tools exist → use `xbot_execute({ toolName, args })` to run them
3. If no saved tool → use `browser_snapshot` to see the page, then `browser_fallback` for raw Playwright actions
4. After completing a task with fallback → save it with `add_create-config` + `add_tool`

**Execution definition shapes:**

Single-page interaction:
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

Multi-step workflow:
```json
{
  "type": "workflow",
  "steps": [
    { "action": "navigate", "urlTemplate": "https://example.com/{query}" },
    { "action": "waitForLoadState", "state": "networkidle", "timeout": 15000 },
    { "action": "wait", "selector": ".results", "timeout": 10000 },
    { "action": "scroll", "distance": 1000, "count": 3, "delay": 1500 },
    { "action": "extract", "selector": ".item", "extractMode": "recordList",
      "fields": [
        { "name": "text", "extract": "innerText" },
        { "name": "url", "subSelector": "a", "extract": "attribute", "attribute": "href" }
      ]
    }
  ]
}
```

**Workflow step types:** `navigate`, `waitForLoadState`, `wait`, `click`, `fill`, `scroll`, `download`, `checkUrl`, `extract`, `return`

**extractMode options:** `text`, `list`, `html`, `attribute`, `table`, `innerText`, `innerTextList`, `recordList`

**Field types:** `fill` (default), `select`, `check`, `radio`, `click`

## Skills

Three agent-driven skills in `skills/`:

| Skill | File | Purpose |
|-------|------|---------|
| `research-tweets` | `skills/research-tweets.md` | Find tweets worth replying to from watchlist + keyword search. Profile authors, assess virality, store candidates in Cortex. |
| `compose-tweets` | `skills/compose-tweets.md` | Write and post replies. Pull voice profile + insights from Cortex, pick strategy, post via `x:post-reply`, record in Cortex. |
| `x-analytics` | `skills/x-analytics.md` | Pull X analytics CSV, score against algorithm weights, store actionable insights in Cortex. |

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

### Data Model — Node Kinds

#### xbot-browser nodes

| Kind | Title | Tags | Body fields | Purpose |
|------|-------|------|-------------|---------|
| `domain` | domain name | `["domain"]` | `url_pattern, title, description, tags` | Site config |
| `tool` | tool name | `["tool"]` | `name, description, input_schema, execution, failure_count, fallback_selectors` | Saved browser tool |

Edges: `domain → tool` with `relation=has_tool`

#### Echo nodes (created by agent via skills)

| Kind | Title | Tags | Body fields | Purpose |
|------|-------|------|-------------|---------|
| `tweet` | tweet_id | `["tweet", "status-queued", "tid-{id}", "author-{handle}"]` | `content, author_handle, tweet_url, virality_assessment, virality_reasoning, author_context, discovered_at` | Discovered tweet candidate |
| `reply` | `reply-{tweet_id}-{ts}` | `["reply", "tweet-{id}", "strategy-{s}"]` | `tweet_id, reply_text, strategy, posted_at, reply_id, reply_url, author_handle` | Posted reply |
| `author` | handle | `["author", "author-{handle}"]` | `handle, display_name, bio, followers, what_they_work_on, communication_style, responds_to_replies, times_we_replied, they_replied_back` | Author profile + interaction history |
| `post` | post_id | `["post", "pid-{id}"]` | `text, impressions, likes, retweets, engagements, bookmarks, posted_at` | Analytics data |
| `insight` | descriptive title | `["insight", "compose-pattern"?]` | `observation, evidence, confidence, source` | Analytics-derived pattern |
| `voice_profile` | profile name | `["voice-profile", "active"?]` | `tone, vocabulary, sentence_structure, hooks, personality_markers` | Voice/style profile |

Edges: `reply → tweet` with `relation=reply_to`

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

The `execution` field on tools is a rich JSON object. The translator generates async Playwright code that runs in the browser context.

**Important:** `browser_run_code` runs in the browser context (like `page.evaluate`). You CANNOT use `require('fs')` or Node.js APIs inside it. To read files from disk, return a path from `browser_run_code` and read it in the outer Node.js handler with `fs`.

### Seed System

`xbot-browser/seeds/tools.json` contains all pre-defined domain configs and tool definitions. On startup, `xbot-browser/src/cortex/seed.js` creates them in Cortex (non-destructive — skips existing tools).

To update a tool definition in Cortex after changing seeds/tools.json:
```bash
node xbot-browser/scripts/update-cortex-tools.js "x:get-list-feed" "x:search-tweets"
```

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
| `action-translator.js` | Tool → Playwright code | `translateAction`, `translateWorkflow` |
| `action-tools.js` | MCP tool schemas (Zod) | `xbotExecuteSchema`, etc. |
| `action-schema.js` | Validation schemas | Zod schemas for params, fields, execution |
| `cortex/cortex-store.js` | Cortex storage layer | `CortexStore` |
| `cortex/cortex-process.js` | Cortex autostart | `ensureCortexRunning` |
| `cortex/seed.js` | Seed tools on startup | `seedIfNeeded` |
| `cortex/tool-index.js` | Local upsert index | `ToolIndex`, `configKey`, `toolKey` |
| `tools/registry.js` | Tool lookup for current page | `ToolRegistry` |
| `tools/fallback.js` | Fallback tracking + save nudges | `FallbackTracker` |
| `browser/session.js` | Browser state save/load | `saveSession`, `loadSession` |
| `browser/anti-detection.js` | Delay/jitter helpers | `resolveDelays`, `generateDelayCode` |

### skills/ (Markdown)

| File | Purpose |
|------|---------|
| `research-tweets.md` | Tweet discovery and candidate evaluation |
| `compose-tweets.md` | Reply writing, posting, and recording |
| `x-analytics.md` | Analytics ingestion and insight generation |

### xbot-browser/seeds/

| File | Purpose |
|------|---------|
| `tools.json` | All pre-defined tools (11 tools across 3 domains) |

### xbot-browser/scripts/

| File | Purpose |
|------|---------|
| `test-x-tools.js` | Integration test for x: tools via MCP client |
| `update-cortex-tools.js` | Patch tool definitions in Cortex from seeds |
| `export-seeds.js` | Export current Cortex tools to seed format |

## Conventions

- **Language:** JavaScript (CommonJS `require`/`module.exports`), NOT TypeScript
- **Style:** No semicolons in some files, semicolons in others — follow the style of the file you're editing
- **Tool naming:** kebab-case verb-noun (`search-products`, `fill-login`, `extract-price`)
- **X tools:** prefixed with `x:` (`x:check-session`, `x:pull-analytics`)
- **MCP tool schemas:** defined using Zod via `playwright-core/lib/mcpBundle`
- **Tests:** Playwright test framework (`@playwright/test`)
- **No TypeScript compilation** — source files are plain .js, only type declarations (`.d.ts`) exist

## Common Tasks

### Adding a new MCP tool

1. Define schema in `action-tools.js` (Zod)
2. Add to `listTools()` array in `xbot-backend.js`
3. Add case to `callTool()` switch in `xbot-backend.js`
4. Implement handler — either as `_handleXxx()` method on XbotBackend, or in a separate file and import

### Adding a new X browser tool

1. Add the tool definition to `seeds/tools.json` with workflow execution steps
2. Restart xbot-browser (seeder creates it in Cortex) or run `update-cortex-tools.js`
3. Test via `xbot_execute({ toolName, args })`

### Building a saved browser tool for a new site

1. Navigate to the site: `browser_navigate({ url })`
2. Take a snapshot: `browser_snapshot({})` — learn the page structure
3. Interact using `browser_fallback` with `ref` values from the snapshot
4. Create a config: `add_create-config({ domain, title })`
5. Save the tool: `add_tool({ configId, name, inputSchema, execution })`
6. Test it: `xbot_execute({ toolName, args })`

### Running tests

```bash
cd xbot-browser
npm test                    # all tests
npm run ctest               # chrome only
npx playwright test tests/cortex/  # cortex tests only
node scripts/test-x-tools.js --browser chrome  # x: tool integration tests
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORTEX_HTTP` | no | `http://localhost:9091` | Cortex HTTP endpoint |
| `CORTEX_DATA_DIR` | no | `./data/cortex` | Cortex data directory |
| `CORTEX_AUTOSTART` | no | `true` | Auto-start Cortex binary |
| `CORTEX_TIMEOUT_MS` | no | `2000` | HTTP timeout for Cortex |

## Do NOT

- Convert files to TypeScript — the project is JavaScript
- Add `pg` or PostgreSQL dependencies — the project uses Cortex
- Change the MCP tool interface (tool names, argument shapes) without updating action-tools.js schemas
- Use `/v1/` prefix on Cortex HTTP calls
- Use `kind` field on edge creation (it's `relation`)
- Assume Cortex has reinforce/decay endpoints (it doesn't)
- Modify `action-translator.js` selector detection logic without understanding both DOM and Playwright code paths
- Use `require()` or Node.js APIs inside `browser_run_code` — it runs in browser context
- Print to `console.log`/`console.info` in xbot-browser server code — it corrupts the MCP stdio stream. Use `console.error` (stderr) for logging.
