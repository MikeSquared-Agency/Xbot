# FaultLine

Agentic risk pricing engine for AI agent deployments.

## Quick Start

```bash
# Start SurrealDB
docker compose up surrealdb

# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8080

# Frontend
cd frontend
npm install
npm run dev
```

## Architecture

- **Backend**: FastAPI + LangGraph + LangChain + SurrealDB
- **Frontend**: Next.js 15 + React 19 + Tailwind CSS
- **Database**: SurrealDB
- **Tracing**: Opik + LangSmith
