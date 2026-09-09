# CLAUDE.md — context for AI agents (PGRide / nbhoodride)

If you are an AI agent reading this repo for the first time, start here.

## CNBSSA agent system (corp)

- **Corp agent system (context layers, memory, learning):** `autonomusFV/agents/CNBSSA_AGENT_SYSTEM.md` (workspace clone path); org conventions: `autonomusFV/org-conventions/`.

Corporation-wide workflow and audits: `autonomusFV/CLAUDE.md`. Product positioning: `autonomusFV/agents/product_knowledge.md` → **PGRide**.

## What this product is

**PGRide** — ride-sharing for Prince George's County, MD (USA): riders, driver-partners, Stripe/cash fares, wallet ledger, driver equity program, super-admin ops. Stack: Node.js/TypeScript, React, PostgreSQL, Railway (`nbhoodride-production.up.railway.app`).

## Workflow

Develop on `develop`; promote to `main` only with Festus's explicit approval after testing. Planning → change-impact audit → implement → test → post-implementation audit.

**Promotion timing (standing instruction, Festus 2026-09-01):** promotions to `main` are batched to the daily quiet window (~03:30 ET / 07:30 UTC) so deploy restarts never blip riders during riding hours. Merge reviewed work to `develop` any time; it ships to `main` in the next window. Exception: urgent rider-blocking fixes promote immediately.


**Rider Promise Review (Festus 2026-09-07):** "reliable" means a rider who books a ride gets picked up, on time, at the quoted price — every time. The numbers are defined in `shared/riderPromise.ts` (rides delivered, strandings, fare accuracy, late pickups, plus what is unclaimed in the next 24h) and computed in `server/riderPromiseReview.ts`. The server posts it to the ops Telegram chat once a day at 4:00 AM Eastern; it is separate from, and named differently to, the GitHub "Daily Reliability Report" (code health). Admin: `GET/POST /api/admin/analytics/rider-promise-review`.

**Proactive reliability (Festus 2026-09-09):** "reliable" also means every feature, menu and button works, and the operator hears about trouble before the rider does. `server/rideRiskWatch.ts` (rules in `shared/rideRisk.ts`) pages the ops Telegram when a scheduled ride is still unclaimed at T-2h and T-15m, and once at T-10 when the driver has no fresh position or is more than 4 miles from the pickup (stamps o120/o15/o10 in `rides.reminder_stamps`; admin `POST /api/admin/analytics/ride-risk-sweep`). Every rider alert, including app crashes from the error boundary (`client_crash`), is also written to `reliability_events`, and the Rider Promise Review reports "App health" and "Paged ahead" lines from it. Production is watched two ways: `server/dependencyWatch.ts` checks the database and Stripe every 10 minutes from inside the server and pages on down/recovered (`GET /health/deps`, admin `POST /api/admin/analytics/dependency-check`); `.github/workflows/production-watch.yml` probes from outside every 10 minutes (`npm run watch:production`) and pages Telegram on a change when the repo secrets `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` are set.
