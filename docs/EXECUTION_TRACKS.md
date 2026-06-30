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

## Track A — Autonomous scope

### Phase A — Foundation (A1–A8)

See PR #38 (if merged). GCS, WS payloads, audit log, quick messages, insights wiring, `.env.example`.

### Phase A — Continued (A9–A11)

| ID | Deliverable | Notes |
|----|-------------|-------|
| A9 | RAG for AI assistant | `knowledge_chunks` + hash embeddings; pgvector extension enabled; reindex admin route |
| A10 | In-app notification inbox | `in_app_notifications` + bell UI; push mirrored when VAPID set |
| A11 | FAQ from real chat excerpts | `getRecentUserChatExcerpts` + anonymized prompt |

---

## Track B — Gated scope (you required)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Live AI + FAQ generation |
| `VAPID_*` | Web push (in-app inbox works without) |
| `DATABASE_URL` | Persist notifications + knowledge index |

---

## Engagement log

| Date | Engagement | Track | PR | Post-audit |
|------|------------|-------|-----|------------|
| 2026-06-30 | Phase A continued (A9–A11) | A | TBD | Pass — see below |

### Phase A9–A11 — Post-engagement audit (2026-06-30)

| Gate | Result |
|------|--------|
| `npm run check` | Pass — migration drift OK (32 tables), tsc clean |
| `npm test` | Pass — 18 tests (4 files), incl. RAG embed + FAQ excerpts |
| Track B vars for live | `ANTHROPIC_API_KEY` (AI/FAQ), `VAPID_*` (push only; inbox works without) |

**Delivered:**

- **A9** — `shared/ragEmbed.ts`, `server/ragService.ts`, `knowledge_chunks` table, RAG injected into AI system prompt, `POST /api/admin/analytics/reindex-knowledge`
- **A10** — `in_app_notifications` table, notification API, `NotificationBell` on rider/driver dashboards, `deliverUserNotification` unifies in-app + push
- **A11** — FAQ generation uses anonymized `chat_messages` excerpts; `sourceCount` from excerpt volume

---

*Update this file at the end of every autonomous engagement.*
