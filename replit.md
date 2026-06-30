# PG Ride

**Full product plan, architecture, roadmap, and backlog:** see [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).

Quick reference:

- **Stack:** React (Vite) + Express + Drizzle + Neon PostgreSQL
- **Deploy:** Railway (`railway.toml`) — `npm run db:push` pre-deploy, `/health` check
- **Quality:** `npm run check` (migration drift + tsc), `npm test` (vitest)
