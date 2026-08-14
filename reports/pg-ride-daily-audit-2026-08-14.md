# PG Ride Daily Audit — 2026-08-14

## Summary
- Overall: **RED**
- **develop ↔ main parity:** 0 commits on `develop` not in `main`, **1** on `main` not in `develop` (`fc6e7ca` — merge PR #209 promote; application tree matches `3390c69` on develop)
- **Promote develop → main:** **N/A (already promoted today)** — sync merge commit back to `develop` for git parity
- Biggest risk to riders or drivers today: **Production and custom domain could not be reached from the audit environment (TLS `ECONNRESET` on all Railway-hosted probes).** If confirmed externally, this is total outage for riders, drivers, and admins.

## Automated gates
- **audit:daily:** **FAIL** (exit 1) — smoke + `/health/ready` fetch failed
- **npm run check:** PASS (migration drift OK, PWA assets OK, `tsc` OK)
- **npm test:** PASS — 40 files, 175 tests
- **smoke:production** (`BASE_URL=https://nbhoodride-production.up.railway.app`): **FAIL** — all core routes `fetch failed` / `ECONNRESET` (`/health`, `/login`, `/signup`, `/privacy`, `/terms`, `/admin/setup`, `/api/csrf`, `/manifest.json`, PWA icons)
- **/health/ready:** **UNREACHABLE** — `TypeError: fetch failed` / `read ECONNRESET` (`scripts/daily-audit.mjs:71`)
- **External probe note:** `curl`/`openssl` to `nbhoodride-production.up.railway.app:443` and `https://railway.app` also reset TLS from this host; `https://github.com` returns 200. Treat production status as **unverified here** — founder must confirm via browser/uptime tool.

## Phase 3b — Scheduled & coworker (E / F)
- **E — Solo schedule:** **CODE-ONLY PASS** — traced `ScheduleRideModal` → ride create; `GET /api/rides/scheduled`; driver board `GET /api/driver/scheduled-rides`; claim `POST /api/driver/rides/:rideId/claim` → `storage.claimScheduledRide`; confirm `POST /api/driver/rides/:rideId/confirm-scheduled`; WS `new_scheduled_ride`, `scheduled_ride_claimed`, `scheduled_ride_taken` in `server/routes.ts`
- **F — Coworker group (`PG-XXXXXX`):** **CODE-ONLY PASS** — `POST /api/rides/create-shared-schedule` requires future `scheduledAt`, `maxSlots: 3`; join `POST /api/rides/join-schedule` inherits `group.scheduledAt`, slot cap + `applyGroupDiscount` at 2+ riders; driver claim uses `assignDriverToSharedScheduleGroup`; UI entry points in `client/src/pages/RiderDashboard.tsx` (`SharedScheduleSheet`, `JoinScheduleModal`)
- Blockers or regressions: **None in code trace**; live behavior not exercised (no production + no test accounts)

## P0 — Fix today
- **[INFRA] [RIDER] [DRIVER] [ADMIN] [PAYMENT] [SAFETY]** Production smoke: **all public routes and `/health` unreachable** from audit runner. Evidence: `npm run audit:daily` smoke failures; `curl -v https://nbhoodride-production.up.railway.app/health` → `Recv failure: Connection reset by peer`; OpenSSL handshake reads 0 bytes. **If external check confirms:** P0 total platform outage — restore Railway service/deploy immediately (Track B).

## P1 — User-blocking
- **[INFRA]** **`peoplegoverned.com` not on Railway app** — DNS A records `15.197.225.128`, `3.33.251.168` (not `69.46.46.90` for `nbhoodride-production.up.railway.app`). HTTPS also `ECONNRESET`. Users on target domain cannot reach PGRide. Evidence: `dig +short peoplegoverned.com`; `curl -v https://peoplegoverned.com/`. Fix: point DNS/CNAME to Railway custom domain (Track B). See `server/phase0Readiness.ts` check `0.7-domain` / `PUBLIC_APP_URL`.
- **[SAFETY]** Guardian/emergency share URLs depend on `PUBLIC_APP_URL` (`server/appUrl.ts`, `POST /api/mobility/guardian-links`, `POST /api/emergency/start`). Wrong domain or outage breaks guardian tracking links (Track B env + DNS).

## P2 — Degraded experience
- **[INFRA]** Alternate domains **`pgride.com`** and **`pgride.app`** — smoke warnings: DNS not resolving (`scripts/smoke-production.mjs`).
- **[INFRA]** **develop/main git skew** — one merge-only commit on `main`; fast-forward `develop` from `main` to avoid integration confusion (Track A git hygiene).

## Backlog metrics
- Pending rider approvals: **N/A** (no read-only DB this run)
- Pending driver approvals: **N/A**
- Stuck active rides: **N/A**
- Payment anomalies: **N/A**

## Recommended actions
| Priority | Action | Owner |
|----------|--------|-------|
| P0 | Confirm `https://nbhoodride-production.up.railway.app/health` from outside cloud agent; if down, inspect Railway deploy logs, restart/redeploy service, verify env vars | Track B |
| P1 | Repoint `peoplegoverned.com` DNS to Railway; set `PUBLIC_APP_URL=https://peoplegoverned.com` (or canonical www) and redeploy | Track B |
| P2 | Merge `main` → `develop` to clear 1-commit skew after promote | Track A / founder |

## Areas checked clean
- **On `main` codebase:** `npm run check`, `npm test` (175/175)
- **Payments (code):** Stripe webhook idempotency via `claimWebhookEvent` at `POST /api/webhooks/stripe` (`server/routes.ts` ~8960); recent promote includes P0 payment fixes (PR #208/#209 — dropped webhooks + stranded rides on payment failure)
- **Scheduled/coworker (code):** API guards for future `scheduledAt`, max 3 slots, group driver assignment, discount logic documented in join path
- **Safety (code):** Emergency/guardian routes present; rate limit on guardian track; share URLs use `resolveAppUrl`

**Code fix PR:** None opened — failures are production reachability/DNS, not a identified regression fixable without external confirmation.
