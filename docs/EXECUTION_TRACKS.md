# PG Ride — Execution Tracks

**How the master plan is split for autonomous vs human-gated work.**

| Document | Role |
|----------|------|
| [`MASTER_PLAN.md`](MASTER_PLAN.md) | What to build (Part I = today, Part II = vision) |
| **This file** | Who executes what, and the audit workflow |
| [`TRACK_B_CREDENTIALS.md`](TRACK_B_CREDENTIALS.md) | **All keys/APIs/decisions needed from you** |

---

## Two tracks

### Track A — Autonomous (agent executes without you)

Work the agent can complete end-to-end: code, migrations, tests, docs, env-**gated** wiring (you add Railway variables when ready).

> **Autonomous directive rule:** When the user says "go autonomously" or similar, that directive is **contingent on this workflow and audits section** — not a bypass of it. The agent proceeds without permission prompts for Track A work but must still run all audits below and only ask the user for Track B decisions it cannot make from docs/code.

**Workflow per engagement:**

1. **Pre-planning audit (baseline)** — `npm run check`, `npm test`, read backlog / Appendix A / phase table; confirm Track A scope; map tasks to files
2. **Pre-implementation audit** — branch, scope diff, migration/live-table risk check; confirm no business decision required
3. **Implement + commit + push + PR**
4. **Post-implementation impact assessment** — re-run gates; verify no regressions; document Track B vars still needed; update engagement log

### Track B — Gated (requires you)

Decisions, credentials, or approvals only you can provide. Agent prepares; you flip the switch.

---

## Track A — Autonomous scope (from MASTER_PLAN)

### Phase A — Foundation (A1–A8) — merged [#38](https://github.com/CNBSSA/nbhoodride/pull/38)

| ID | Deliverable | Env vars needed later |
|----|-------------|------------------------|
| A1 | GCS object storage (`objectStorage.ts`) | `GCS_BUCKET_NAME` |
| A2 | WebSocket `driver_location` payload alignment | None |
| A3 | `agent_audit_log` table + logging on dispatch | None |
| A4 | Canned ride quick-messages (API + UI) | None |
| A5 | Safety detect → `platform_insights` wiring | None |
| A6 | `.env.example` documenting Track B vars | None |
| A7 | Tests for WS payload + quick messages | None |
| A8 | MASTER_PLAN / doc hygiene | None |

### Phase A — Continued (A9–A11) — [#39](https://github.com/CNBSSA/nbhoodride/pull/39)

| ID | Deliverable | Notes |
|----|-------------|-------|
| A9 | RAG / pgvector for AI assistant | `knowledge_chunks` + hash embeddings; reindex route |
| A10 | In-app notification inbox | Bell UI; push when VAPID set |
| A11 | FAQ from real chat excerpts | Anonymized `chat_messages` prompt |

### Part II — Phase B — Delegative UI — merged [#40](https://github.com/CNBSSA/nbhoodride/pull/40)

| ID | Deliverable | Notes |
|----|-------------|-------|
| B1 | `RideSurface` GenUI renderer + schema | Whitelisted component tree |
| B2 | Orchestrator intent parsing | `POST /api/mobility/intent` |
| B3 | Home screen intent card | Rider dashboard idle state |
| B4 | "Same as last time" ride template | From last completed ride |
| B5 | Autonomy Dial user setting | `user_autonomy_settings` |
| B6 | Voice booking lane | Web Speech API (browser) |
| B7 | Guardian Mode v1 | Tracking share links |

### Part II — Phase C — Trust Graph — merged [#41](https://github.com/CNBSSA/nbhoodride/pull/41)

| ID | Deliverable | Notes |
|----|-------------|-------|
| C1 | `trust_edges` + Trust Score | `shared/trustScore.ts` |
| C2 | Trust-weighted dispatch | `findBestDriver` + audit metadata |
| C3 | Favorite drivers + separation filter | Profile `TrustPreferences` |
| C4 | Community referral chains | `community_referrals` API |
| C5 | Community anchors (seeded) | PG County churches, Metro, campuses |
| C6 | Explainable match cards | `ExplainableMatchCard` on rider dashboard |

### Part II — Phase D — Predictive Co-op — merged [#42](https://github.com/CNBSSA/nbhoodride/pull/42)

| ID | Deliverable | Notes |
|----|-------------|-------|
| D1 | Demand forecast worker + heatmap v2 | `demand_forecasts` + merged heatmap API |
| D2 | Driver Earnings Coach | `EarningsCoachCard` on driver insights |
| D3 | Supply positioning nudges | Push to offline drivers at peak hours |
| D4 | Pricing Fairness Agent | `community_bonus_pool` — no surge |
| D5 | Ownership Agent projections | Driver ownership dashboard |
| D6 | Scheduled ride auto-rebook | `recurring_ride_schedules` + prompts |
| D7 | Safety anomaly layer | Route deviation on live GPS |

### Part II — Phase E — Autonomous Operations — merged [#47](https://github.com/CNBSSA/nbhoodride/pull/47)

| ID | Deliverable | Notes |
|----|-------------|-------|
| E1 | Support Agent auto-resolve ≤$25 | `supportPolicy` + dispute hook |
| E2 | Compliance Agent | W-9 / doc expiry scan; `TAX_COMPLIANCE_PATH` |
| E3 | Admin approve-and-apply | `agent_action_proposals` + Agents tab |
| E4 | SMS booking + tracking | `POST /api/sms/inbound` (Twilio gated) |
| E5 | PWA lock screen widgets | SW badge + manifest widgets |
| E6 | Calm Ride mode | `user_ride_preferences` + Profile toggle |
| E7 | Multi-language | en / es / fr via `shared/i18n` |

### Part II — Phase F — Research — merged [#49](https://github.com/CNBSSA/nbhoodride/pull/49)

| ID | Deliverable | Notes |
|----|-------------|-------|
| F1 | L4 readiness logging | `l4_readiness_events` + waypoint quality on GPS track |
| F2 | Certificate provenance | SHA-256 off-chain hash; optional on-chain later |
| F3 | Transit integration | `transit_feed_cache` + `/api/transit/alerts`; `WMATA_API_KEY` |
| F4 | EV green bonus | `vehicles.is_ev` + community bonus pool allocation |

### Backlog — Lost & Found — merged [#52](https://github.com/CNBSSA/nbhoodride/pull/52)

| ID | Deliverable | Notes |
|----|-------------|-------|
| LF1 | Lost item reports | `lost_found_reports` + rider modal |
| LF2 | Driver response flow | Has item / returned / not in car |
| LF3 | Support agent notifications | Driver + rider in-app alerts |
| LF4 | Admin mediation panel | Lost & Found tab |

### Part II — Later autonomous lanes

| Phase | Agent can build | You provide later |
|-------|-----------------|-------------------|
| G+ | TBD per MASTER_PLAN backlog | Board / partnership decisions |

---

## Track B — Gated scope (you required)

### Credentials (Railway → Variables)

| Variable | Purpose | When |
|----------|---------|------|
| `DATABASE_URL` | Neon PostgreSQL | Before any deploy |
| `SESSION_SECRET` | Session signing | Before deploy |
| `STRIPE_SECRET_KEY` / `VITE_STRIPE_PUBLIC_KEY` | Payments | Before card/top-up live |
| `ANTHROPIC_API_KEY` | AI assistant + orchestrator | Before AI live |
| `GCS_BUCKET_NAME` + GCS credentials | Driver documents | Before doc uploads live |
| `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` | Push notifications | Before push live |
| `TWILIO_*` | SOS SMS | Optional |
| `SUPER_ADMIN_SETUP_TOKEN` | Bootstrap super admin | Once, at setup |

### Business decisions

| Item | Decision needed |
|------|-----------------|
| AH-060 tax compliance | Path A vs B vs C — MASTER_PLAN §15 |
| Profit declarations | Board sign-off on amounts |
| Admin approvals | User/driver approval in production |
| Marketing launch | Channels, events, spend |
| PR merge / deploy | Approve merge to `main` + Railway deploy |

---

## Engagement log

| Date | Engagement | Track | PR | Post-audit |
|------|------------|-------|-----|------------|
| 2026-06-30 | Phase A foundation (A1–A8) | A | [#38](https://github.com/CNBSSA/nbhoodride/pull/38) | Pass — merged |
| 2026-06-30 | Phase A continued (A9–A11) | A | [#39](https://github.com/CNBSSA/nbhoodride/pull/39) | Pass — conflict resolved vs #38 |
| 2026-06-30 | Phase B delegative UI (B1–B7) | A | [#40](https://github.com/CNBSSA/nbhoodride/pull/40) | Pass — see below |
| 2026-06-30 | Phase C trust graph (C1–C6) | A | [#41](https://github.com/CNBSSA/nbhoodride/pull/41) | Pass — see below |
| 2026-06-30 | Phase D predictive co-op (D1–D7) | A | [#42](https://github.com/CNBSSA/nbhoodride/pull/42) | Pass — see below |
| 2026-06-30 | Phase E autonomous ops (E1–E7) | A | [#47](https://github.com/CNBSSA/nbhoodride/pull/47) | Pass — see below |
| 2026-06-30 | Phase F research (F1–F4) | A | [#49](https://github.com/CNBSSA/nbhoodride/pull/49) | Pass — see below |
| 2026-07-01 | Lost & found workflow (LF1–LF4) | A | [#52](https://github.com/CNBSSA/nbhoodride/pull/52) | Pass — see below |
| 2026-07-01 | Ride for a friend + credentials (RFF1–RFF4) | A | [#54](https://github.com/CNBSSA/nbhoodride/pull/54) | Pass — see below |
| 2026-07-01 | Vehicle types, community routes, referral UI (VT/CR/REF) | A | [#56](https://github.com/CNBSSA/nbhoodride/pull/56) | Pass — see below |
| 2026-07-01 | Referral wallet credits + Driver Pro tiers (REF2/PRO1) | A | [#57](https://github.com/CNBSSA/nbhoodride/pull/57) | Pass — see below |
| 2026-07-01 | Mobility intent TTL purge + MASTER_PLAN sync (PRIV1) | A | [#58](https://github.com/CNBSSA/nbhoodride/pull/58) | Pass — see below |
| 2026-07-01 | Ride receipts polish (RCP1) | A | [#59](https://github.com/CNBSSA/nbhoodride/pull/59) | Pass — see below |
| 2026-07-02 | Free-text ride chat (CHAT1) | A | [#60](https://github.com/CNBSSA/nbhoodride/pull/60) | Pass — see below |

### Phase A9–A11 — Post-engagement audit

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 32+ tables, tsc clean |
| `npm test` | Pass — 18 tests |
| PR #39 conflict | Resolved — merged `main` (#38) with A9–A11; kept both `agent_audit_log` + `knowledge_chunks` + `in_app_notifications` |

### Phase B — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 38 tables, tsc clean |
| `npm test` | Pass — 25 tests |

**Delivered (B1–B7):** GenUI `RideSurface`, orchestrator + intent API, home intent card, ride templates, autonomy dial, voice input, guardian tracking links.

### Phase C — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 43 tables |
| `npm test` | Pass — 29 tests |

### Phase D — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 47 tables |
| `npm test` | Pass — 33 tests |

### Phase E — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 51 tables |
| `npm test` | Pass — 41 tests |

**Delivered (E1–E7):** Support auto-resolve, compliance agent, admin approve-and-apply, SMS adapter, PWA widgets, Calm Ride, i18n.

**App stores:** Phased plan — [APP_STORE_PLAN.md](./APP_STORE_PLAN.md) (web first). Build runbook: [APP_STORE_READINESS.md](./APP_STORE_READINESS.md).

### Phase F — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 54 tables |
| `npm test` | Pass — 50 tests |

**Delivered (F1–F4):** L4 readiness logging, certificate SHA-256 provenance, transit feed cache + rider alerts, EV green bonus from community pool.

### Lost & Found — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 55 tables |
| `npm test` | Pass — 72 tests |

**Delivered (LF1–LF4):** Lost item reports, driver response flow, Support notifications, admin Lost & Found tab.

### Backlog — Ride for a friend — merged [#54](https://github.com/CNBSSA/nbhoodride/pull/54)

| ID | Deliverable | Notes |
|----|-------------|-------|
| RFF1 | Booker pays, passenger rides | `rides.booked_for_friend` + passenger fields |
| RFF2 | Rider booking UI | `RideForFriendFields` on confirm step |
| RFF3 | Driver visibility | Incoming + active ride passenger label |
| RFF4 | Track B credentials inventory | `docs/TRACK_B_CREDENTIALS.md` |

### Backlog — Vehicle types, community routes, referral UI

| ID | Deliverable | Notes |
|----|-------------|-------|
| VT1 | Vehicle type on fleet | `vehicles.vehicle_type` + driver profile picker |
| VT2 | Rider vehicle preference | `rides.requested_vehicle_type` + nearby-drivers filter |
| CR1 | Community route presets | `community_routes` + seeded PG corridors |
| CR2 | Rider quick-pick UI | `CommunityRoutesCard` on idle dashboard |
| REF1 | Referral program UI | `GET /api/trust/referrals/mine` + Profile card |

### Backlog — Referral credits + Driver Pro tiers

| ID | Deliverable | Notes |
|----|-------------|-------|
| REF2 | Referral PG Card payout | Atomic wallet credit on redeem (referrer + redeemer) |
| PRO1 | Driver Pro tiers | Computed badges; rider match cards + driver dashboard |

### Backlog — Privacy + doc hygiene

| ID | Deliverable | Notes |
|----|-------------|-------|
| PRIV1 | `mobility_intents` 90-day purge | Daily worker + admin route; PR #46 follow-up |

### Ride for a friend — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 55 tables |
| `npm test` | Pass — 74 tests |

**Delivered (RFF1–RFF4):** Friend booking, rider UI, driver passenger label, credentials inventory.

### Vehicle types, community routes, referral UI — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 56 tables |
| `npm test` | Pass — 81 tests |

**Delivered (VT1–REF1):** Vehicle type on fleet + rider picker, nearby-drivers filter, `community_routes` seeded corridors, idle quick-pick UI, referral Profile card + `GET /api/trust/referrals/mine`.

### Referral credits + Driver Pro tiers — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 56 tables |
| `npm test` | Pass — 99 tests |

**Delivered (REF2/PRO1):** Atomic PG Card credits on referral redeem, in-app notifications, Driver Pro tier badges on match cards and driver dashboard.

### Mobility intent TTL + MASTER_PLAN sync — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 56 tables |
| `npm test` | Pass — 101 tests |

**Delivered (PRIV1):** 90-day `mobility_intents` purge (daily 03:00 UTC + admin route), MASTER_PLAN status tables synced to merged PRs.

### Ride receipts polish — Post-implementation audit (2026-07-01)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 56 tables |
| `npm test` | Pass — 104 tests |

**Delivered (RCP1):** Shared receipt builder, itemized RideReceiptModal with download, history list enrichment + period filter.

### Free-text ride chat — Post-implementation audit (2026-07-02)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — 57 tables |
| `npm test` | Pass — 111 tests |

**Delivered (CHAT1):** `ride_messages` table, GET/POST chat API, WS `ride_message` delivery, `RideChat` UI on rider/driver dashboards, quick messages persisted.

---

## How to read status

- **Code merged, env unset** → Track A done; flip Track B var when ready
- **Blocked on decision** → Track B; agent documents options only
- **Green `npm run check` + `npm test`** → Post-engagement audit pass for that PR

*Update this file at the end of every autonomous engagement.*
