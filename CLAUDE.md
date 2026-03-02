# CLAUDE.md — Agent Instructions for Xbot

## Project Overview

Xbot is an MCP server for browser automation that learns and reuses procedures. It has two main components:

1. **xbot-browser** (Node.js) — MCP server built on Playwright with stored tools, graph memory (Cortex), and anti-detection
2. **echo** (Python) — Tweet discovery and engagement system that uses xbot-browser as an MCP client

## Critical Architecture

### Storage Layer

The storage backend is **Cortex** (graph memory engine at localhost:9091). The storage class is `CortexStore` in `xbot-browser/src/cortex/cortex-store.js`.

**Data model in Cortex:**
- Domain configs → nodes with `kind=domain`, structured data in `body` as JSON
- Tools → nodes with `kind=tool`, execution/input_schema in `body` as JSON
- Config→Tool relationship → edges with `relation=has_tool`
- Local upsert tracking → `ToolIndex` in `xbot-browser/src/cortex/tool-index.js` (JSON file at `data/cortex/tool-index.json`)

**Cortex HTTP API (port 9091):**
- No `/v1/` prefix — endpoints are `/nodes`, `/edges`, `/search`, `/briefing/:agent_id`
- All responses wrapped in `{ success: bool, data: ..., error: ... }`
- `kind` in requests: lowercase (`"domain"`, `"tool"`)
- `kind` in responses: PascalCase (`"Domain"`, `"Tool"`) — compare case-insensitively
- `relation` on edges: lowercase + underscores only (`"has_tool"`, `"supersedes"`)
- No metadata field on HTTP API — encode structured data in `body` field as JSON string
- Write gate bypass: use `?gate=skip` query param + `x-gate-override: true` header
- No reinforce/decay endpoints — use `PATCH /nodes/:id` with `{ importance: newValue }`

### Main Orchestrator

`xbot-browser/src/xbot-backend.js` — **XbotBackend class** (830 lines). This is the central file. It:
- Extends Playwright's BrowserServerBackend
- Registers all MCP tools in `listTools()`
- Dispatches tool calls in `callTool()` via switch statement
- Handles navigation with multi-stage URL resolution (server redirect, SPA redirect)
- Manages tool execution with selector resilience (fallback selectors, failure counting)

### Tool Execution Pipeline

```
Tool definition (from Cortex) → action-translator.js → Playwright code string → browser_run_code
```

The `execution` field on tools is a rich JSON object: `{ fields, submit, waitFor, resultSelector, resultType, resultExtract, delays, scrolls, verifySelector }`. The translator generates async Playwright code that runs in the browser context.

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
| `action-tools.js` | MCP tool schemas (Zod) | `xbotExecuteSchema`, `addToolSchema`, etc. |
| `action-schema.js` | Validation schemas | Zod schemas for params, fields, execution |
| `cortex/cortex-store.js` | Cortex storage layer | `CortexStore` |
| `cortex/cortex-process.js` | Cortex autostart | `ensureCortexRunning` |
| `cortex/tool-index.js` | Local upsert index | `ToolIndex`, `configKey`, `toolKey` |
| `tools/registry.js` | Tool lookup for current page | `ToolRegistry` |
| `tools/fallback.js` | Fallback tracking + save nudges | `FallbackTracker` |
| `tools/x-tools.js` | X session checking | `handleCheckSession` |
| `browser/session.js` | Browser state save/load | `saveSession`, `loadSession` |
| `browser/anti-detection.js` | Delay/jitter helpers | `resolveDelays`, `generateDelayCode` |

### echo/ (Python)

| Directory | Purpose |
|-----------|---------|
| `orchestrator.py` | Main loop |
| `scout/` | Tweet discovery |
| `compose/` | Reply generation (Anthropic API) |
| `analytics/` | Performance tracking |
| `voice/` | Voice profile analysis |
| `xbot/client.py` | MCP client for xbot-browser |

## Conventions

- **Language:** JavaScript (CommonJS `require`/`module.exports`), NOT TypeScript
- **Style:** No semicolons in some files, semicolons in others — follow the style of the file you're editing
- **Tool naming:** kebab-case verb-noun (`search-products`, `fill-login`, `extract-price`)
- **X tools:** prefixed with `x:` (`x:check-session`)
- **MCP tool schemas:** defined using Zod via `playwright-core/lib/mcpBundle`
- **Tests:** Playwright test framework (`@playwright/test`)
- **No TypeScript compilation** — source files are plain .js, only type declarations (`.d.ts`) exist

## Common Tasks

### Adding a new MCP tool

1. Define schema in `action-tools.js` (Zod)
2. Add to `listTools()` array in `xbot-backend.js`
3. Add case to `callTool()` switch in `xbot-backend.js`
4. Implement handler as `_handleXxx()` method on XbotBackend

### Modifying tool storage

All storage goes through `CortexStore` methods. The return objects must match the shapes that `ToolRegistry` and `XbotBackend._handleExecute()` expect:
- Config-like: `{ id, domain, url_pattern, title, description, tags, visit_count }`
- Tool-like: `{ id, config_id, name, description, input_schema, execution, failure_count, fallback_selectors, domain, url_pattern, config_title }`

### Modifying tool execution

The execution pipeline is in `action-translator.js`. It generates a string of async Playwright code. Key phases:
1. Fill fields (batch DOM ops or Playwright API calls)
2. Submit (click or keypress)
3. Wait for results
4. Extract results (DOM query or Playwright locator)

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
