# Xbot

An MCP server for browser automation that learns and reuses procedures, built for X (Twitter) automation.

---

## How It Works

xbot-browser is an [MCP](https://modelcontextprotocol.io/) server built on [Playwright](https://playwright.dev) with **stored tools, memory, and anti-detection**.

When you navigate to a site:

1. **Known site**: Looks up the domain and URL pattern in its database. If stored tools exist (e.g. `x:get-list-feed`, `x:post-reply`), they're immediately available. The LLM calls them by name with parameters, and xbot translates them into Playwright actions.

2. **New site**: No stored tools exist yet, so xbot falls back to raw Playwright tools. As the LLM explores the page, xbot nudges it to save what it learns as reusable tools so the next visit is instant.

## Features

- **Stored tool system** — Save and reuse browser automation procedures across sessions
- **Local embeddings** — Semantic search for sites/tools via `Xenova/all-MiniLM-L6-v2` (no cloud API needed)
- **Session persistence** — Save/load browser login state with `--session-file`
- **Anti-detection** — Configurable delays, typing simulation, scroll behavior
- **Selector resilience** — Fallback selectors and automatic failure tracking
- **X (Twitter) tools** — Pre-built tools for feed reading, posting, searching, and metrics

## Project Structure

```
xbot/
├── xbot-browser/           # MCP server (Node.js)
│   ├── src/
│   │   ├── xbot-backend.js     # Main orchestrator
│   │   ├── action-store.js      # DB + local embeddings
│   │   ├── action-translator.js # Tool → Playwright code
│   │   ├── action-tools.js      # MCP tool schemas
│   │   ├── action-schema.js     # Validation schemas
│   │   ├── tools/
│   │   │   ├── registry.js      # Tool lookup logic
│   │   │   ├── fallback.js      # Fallback/nudge logic
│   │   │   └── x-tools.js       # X-specific handlers
│   │   └── browser/
│   │       ├── session.js        # Session save/load
│   │       └── anti-detection.js # Delay helpers
│   └── scripts/
│       └── train-x-tools.js     # X tool training script
└── supabase/                # Database migrations
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- A PostgreSQL database with the [pgvector](https://github.com/pgvector/pgvector) extension

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/DarlingtonDeveloper/Xbot.git
cd Xbot
```

### 2. Set up the database

```bash
psql $DATABASE_URL -f supabase/migrations/0001_init_schema.sql
psql $DATABASE_URL -f supabase/migrations/0005_xbot_schema.sql
```

### 3. Configure environment

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

### 4. Install xbot-browser

```bash
cd xbot-browser
npm install
npx playwright install
```

### 5. Train X tools (optional)

```bash
npm run train:x
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

### Anti-detection environment variables

```bash
XBOT_DELAY_BEFORE_ACTION=500
XBOT_DELAY_AFTER_ACTION=300
XBOT_DELAY_TYPING=80
XBOT_DELAY_JITTER=200
```

## License

Apache 2.0
