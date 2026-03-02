# Xbot

An MCP server for browser automation that learns and reuses procedures, built for X (Twitter) automation. Powered by [Cortex](https://github.com/MikeSquared-Agency/cortex) graph memory.

---

## How It Works

xbot-browser is an [MCP](https://modelcontextprotocol.io/) server built on [Playwright](https://playwright.dev) with **stored tools, graph memory, and anti-detection**.

When you navigate to a site:

1. **Known site**: Looks up the domain in Cortex's knowledge graph. If stored tools exist (e.g. `search-products`, `x:post-reply`), they're immediately available along with a domain briefing. The LLM calls them by name with parameters, and xbot translates them into Playwright actions.

2. **New site**: No stored tools exist yet, so xbot falls back to raw Playwright tools. As the LLM explores the page, xbot nudges it to save what it learns as reusable tools so the next visit is instant.

3. **Cross-domain learning**: Cortex's auto-linker detects semantic similarity between tools on different sites. Tools learned on `amazon.com` can surface as suggestions on `amazon.co.uk`.

## Features

- **Stored tool system** — Save and reuse browser automation procedures across sessions
- **Graph memory (Cortex)** — Domain knowledge, tool relationships, and semantic search in a persistent knowledge graph
- **Domain briefings** — LLM receives contextual memory about known sites on navigation
- **Importance feedback** — Successful tool executions boost node importance; repeated failures decay it
- **Session persistence** — Save/load browser login state with `--session-file`
- **Anti-detection** — Configurable delays, typing simulation, scroll behavior
- **Selector resilience** — Fallback selectors and automatic failure tracking with relearn nudges
- **X (Twitter) tools** — Pre-built tools for feed reading, posting, searching, and metrics

## Project Structure

```
xbot/
├── xbot-browser/               # MCP server (Node.js)
│   ├── src/
│   │   ├── xbot-backend.js         # Main orchestrator
│   │   ├── action-store.js          # In-memory store + local embeddings
│   │   ├── utils.js                 # Shared utilities (extractDomain, matchUrlPattern)
│   │   ├── action-translator.js     # Tool → Playwright code generator
│   │   ├── action-tools.js          # MCP tool schemas
│   │   ├── action-schema.js         # Validation schemas (Zod)
│   │   ├── cortex/
│   │   │   ├── cortex-store.js      # Cortex storage layer (replaces Postgres)
│   │   │   ├── cortex-process.js    # Cortex autostart manager
│   │   │   └── tool-index.js        # Local upsert index (JSON on disk)
│   │   ├── tools/
│   │   │   ├── registry.js          # Tool lookup logic
│   │   │   ├── fallback.js          # Fallback/nudge logic
│   │   │   └── x-tools.js           # X (Twitter) handlers
│   │   └── browser/
│   │       ├── session.js           # Session save/load
│   │       └── anti-detection.js    # Delay helpers
│   └── tests/
├── echo/                        # Tweet discovery & engagement (Python)
│   ├── orchestrator.py              # Main orchestration loop
│   ├── scout/                       # Tweet discovery
│   ├── compose/                     # Reply generation
│   ├── analytics/                   # Performance tracking
│   ├── voice/                       # Voice profile analysis
│   └── xbot/                        # Xbot MCP client
├── cortex.toml                  # Cortex server configuration
├── docker-compose.yml           # Cortex container setup
└── supabase-archived/           # Legacy Postgres migrations (archived)
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Cortex](https://github.com/MikeSquared-Agency/cortex) — graph memory engine:

```bash
curl -sSf https://raw.githubusercontent.com/MikeSquared-Agency/cortex/main/install.sh | sh
```

> **First run:** Cortex downloads the embedding model (~150MB). This happens automatically on first start and takes 1–2 minutes.

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/DarlingtonDeveloper/Xbot.git
cd Xbot
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your API keys. Key Cortex variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CORTEX_HTTP` | `http://localhost:9091` | Cortex HTTP endpoint |
| `CORTEX_DATA_DIR` | `./data/cortex` | Cortex data directory |
| `CORTEX_AUTOSTART` | `true` | Auto-start Cortex on xbot-browser startup |
| `CORTEX_TIMEOUT_MS` | `2000` | HTTP request timeout for Cortex calls |


### 3. Install xbot-browser

```bash
cd xbot-browser
npm install
npx playwright install
```

### 4. Start

Cortex starts automatically when xbot-browser starts (`CORTEX_AUTOSTART=true`).

To start Cortex manually instead:

```bash
cortex serve
```

To inspect the knowledge graph: http://localhost:9091/viz

### 5. Install echo (optional — X/Twitter automation)

```bash
cd echo
pip install -e .
```

## Usage

### MCP server config

```json
{
  "mcpServers": {
    "xbot-browser": {
      "command": "node",
      "args": ["/absolute/path/to/Xbot/xbot-browser/cli.js"]
    }
  }
}
```

### CLI options

- `--browser <browser>` — Browser to use (`chrome`, `firefox`, `webkit`, `chromium`, `msedge`)
- `--headless` — Run in headless mode
- `--session-file <path>` — Path to session file for persistent login state

### MCP Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL — loads stored tools and domain briefing |
| `browser_snapshot` | Accessibility snapshot of the current page |
| `xbot_execute` | Run a stored tool by name with parameters |
| `xbot_memory` | Semantic search for saved sites and tools |
| `browser_fallback` | Gateway to raw Playwright tools |
| `add_create-config` | Create a domain config |
| `add_tool` | Save a new tool to a config |
| `add_update-tool` | Update an existing tool |
| `add_delete-tool` | Remove a tool |
| `x:check-session` | Check X (Twitter) login state |

### Anti-detection environment variables

```bash
XBOT_DELAY_BEFORE_ACTION=500
XBOT_DELAY_AFTER_ACTION=300
XBOT_DELAY_TYPING=80
XBOT_DELAY_JITTER=200
```

### Docker

```bash
docker compose up -d    # starts Cortex
```

## Architecture

```
┌──────────────┐     MCP      ┌───────────────┐    HTTP     ┌────────────┐
│  Claude /    │ ◄──────────► │  xbot-browser  │ ◄────────► │   Cortex   │
│  LLM Client  │              │  (Node.js)     │            │  (:9091)   │
└──────────────┘              └───────┬────────┘            └─────┬──────┘
                                      │                           │
                                      │ Playwright                │ Graph DB
                                      ▼                           ▼
                               ┌──────────────┐           ┌──────────────┐
                               │   Browser    │           │  memory.redb │
                               │  (Chromium)  │           │  + vectors   │
                               └──────────────┘           └──────────────┘
```

**Navigation flow:**
1. LLM calls `browser_navigate` → xbot queries Cortex for stored tools
2. Known site → tools + domain briefing injected into response → LLM uses `xbot_execute`
3. Unknown site → LLM uses `browser_fallback` → xbot nudges to save tools → tools stored in Cortex
4. Successful tool execution → importance boosted in Cortex
5. Selector failure → importance decayed, fallback selectors tried, relearn nudge after 3 failures

## License

Apache 2.0
