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

### Phase A — Foundation (agent-owned)

| ID | Deliverable | Env vars needed later |
|----|-------------|------------------------|
| A1 | GCS object storage implementation (`objectStorage.ts`) | `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS` (or Railway GCS plugin) |
| A2 | WebSocket `driver_location` payload alignment | None |
| A3 | `agent_audit_log` table + logging on dispatch events | None |
| A4 | Canned ride quick-messages (API + UI) | None |
| A5 | Safety detect → `platform_insights` wiring | None |
| A6 | `.env.example` documenting all Track B vars | None |
| A7 | Tests for WS payload + canned messages | None |
| A8 | MASTER_PLAN / doc hygiene | None |

### Phase A — Deferred autonomous (next PRs)

| ID | Deliverable | Notes |
|----|-------------|-------|
| A9 | RAG / pgvector for AI assistant | Needs `ANTHROPIC_API_KEY` to test live |
| A10 | In-app notification inbox | UI only; push needs VAPID |
| A11 | FAQ generation uses real chat excerpts | Needs Anthropic key to verify |

### Part II — Autonomous code lanes (later)

| Phase | Agent can build | You provide later |
|-------|-----------------|-------------------|
| B — Delegative UI | GenUI schema, renderer, intent cards | None for dev |
| C — Trust graph | Tables, scoring, dispatch weights | Community org opt-in data |
| D — Predictive | Forecast workers, coach copy | None for dev |
| E — Ops agents | Support tool-calling, SMS adapter | Twilio, production keys |

---

## Track B — Gated scope (you required)

### Credentials (Railway → Variables)

| Variable | Purpose | When |
|----------|---------|------|
| `DATABASE_URL` | Neon PostgreSQL | Before any deploy |
| `SESSION_SECRET` | Session signing | Before deploy |
| `STRIPE_SECRET_KEY` / `VITE_STRIPE_PUBLIC_KEY` | Payments | Before card/top-up live |
| `ANTHROPIC_API_KEY` | AI assistant | Before AI live |
| `GCS_BUCKET_NAME` + GCS credentials | Driver documents | Before doc uploads live |
| `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` | Push notifications | Before push live |
| `TWILIO_*` | SOS SMS | Optional |
| `SUPER_ADMIN_SETUP_TOKEN` | Bootstrap super admin | Once, at setup |

### Business decisions

| Item | Decision needed |
|------|-----------------|
| AH-060 tax compliance | Path A (Stripe Connect) vs B (Tax1099) vs C (manual) — MASTER_PLAN §15 |
| Profit declarations | Board sign-off on amounts |
| Admin approvals | User/driver approval in production |
| Marketing launch | Channels, events, spend |
| PR merge / deploy | Approve merge to `main` + Railway deploy |
| Domain / DNS | Production URL |

### Not agent-autonomous

- Creating Stripe / Anthropic / GCS accounts
- Paying for Railway / Neon
- Legal / CPA sign-off on 1099 flow
- Community partnerships and flyers

---

## Engagement log

| Date | Engagement | Track | PR | Post-audit |
|------|------------|-------|-----|------------|
| 2026-06-30 | Phase A foundation (A1–A8) | A | #38 | Pass — see below |

### Phase A — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — migration drift OK (31 tables), tsc clean |
| `npm test` | Pass — 13 tests (3 files), incl. WS payload + quick messages |
| Track B vars required to go live | `GCS_BUCKET_NAME` (uploads), `DATABASE_URL` (audit log persist) — code degrades without them |
| Deferred to next autonomous PR | A9 RAG, A10 notification inbox, A11 FAQ excerpts |

**Delivered (A1–A8):**

- **A1** — `server/objectStorage.ts`: GCS signed URLs + download when `GCS_BUCKET_NAME` set; stub error when unset
- **A2** — `server/wsDriverLocation.ts` + rider WS handler: normalized `driver_location` with legacy `lat`/`lng`
- **A3** — `agent_audit_log` table, migration, `createAgentAuditLog` on ride accept
- **A4** — `POST /api/rides/:rideId/quick-message`, `RideQuickMessages` on rider + driver active ride UI
- **A5** — Critical safety alerts → `createPlatformInsight` in routes
- **A6** — `.env.example` documents all Track B variables
- **A7** — `shared/quickRideMessages.test.ts` + WS builder tests
- **A8** — `EXECUTION_TRACKS.md`, `MASTER_PLAN.md` cross-links

---

## How to read status

- **Code merged, env unset** → Track A done; flip Track B var when ready
- **Blocked on decision** → Track B; agent documents options only
- **Green `npm run check` + `npm test`** → Post-engagement audit pass for that PR

*Update this file at the end of every autonomous engagement.*
