# PG Ride

**Product plan:** [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md)  
**AI-native vision:** [`docs/VISION_AI_NATIVE.md`](docs/VISION_AI_NATIVE.md)

Quick reference:

- **Stack:** React (Vite) + Express + Drizzle + Neon PostgreSQL
- **Deploy:** Railway (`railway.toml`) — `npm run db:push` pre-deploy, `/health` check
- **Quality:** `npm run check` (migration drift + tsc), `npm test` (vitest)
