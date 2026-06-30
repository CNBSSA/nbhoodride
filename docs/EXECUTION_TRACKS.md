# PG Ride — Execution Tracks

**How the master plan is split for autonomous vs human-gated work.**

| Document | Role |
|----------|------|
| [`MASTER_PLAN.md`](MASTER_PLAN.md) | What to build (Part I = today, Part II = vision) |
| **This file** | Who executes what, and the audit workflow |

---

## Two tracks

### Track A — Autonomous (agent executes without you)

Work the agent can complete end-to-end: code, migrations, tests, docs, env-**gated** wiring (you add Railway variables when ready).

**Workflow per engagement:**

1. **Baseline audit** — `npm run check`, `npm test`, read backlog / Appendix A
2. **Planning audit** — map tasks to files; confirm no business decision required
3. **Pre-engagement audit** — branch, scope diff, risk check
4. **Implement + commit + push + PR**
5. **Post-engagement audit** — re-run gates; document what still needs Track B vars

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

### Part II — Phase E — Autonomous Operations (in progress)

| ID | Deliverable | Notes |
|----|-------------|-------|
| E1 | Support Agent auto-resolve ≤$25 | `supportPolicy` + dispute hook |
| E2 | Compliance Agent | W-9 / doc expiry scan; `TAX_COMPLIANCE_PATH` |
| E3 | Admin approve-and-apply | `agent_action_proposals` + Agents tab |
| E4 | SMS booking + tracking | `POST /api/sms/inbound` (Twilio gated) |
| E5 | PWA lock screen widgets | SW badge + manifest widgets |
| E6 | Calm Ride mode | `user_ride_preferences` + Profile toggle |
| E7 | Multi-language | en / es / fr via `shared/i18n` |

### Part II — Later autonomous lanes

| Phase | Agent can build | You provide later |
|-------|-----------------|-------------------|
| F — Research | L4 data, transit APIs | WMATA keys, org partnerships |

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

---

## How to read status

- **Code merged, env unset** → Track A done; flip Track B var when ready
- **Blocked on decision** → Track B; agent documents options only
- **Green `npm run check` + `npm test`** → Post-engagement audit pass for that PR

*Update this file at the end of every autonomous engagement.*
