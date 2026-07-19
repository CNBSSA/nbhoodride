# PG Ride — Daily audit playbook

**Purpose:** What can go wrong daily for riders, drivers, and admins — and how AI agents should investigate.  
**Short prompt to start the agent:** [DAILY_AUDIT_AGENT_INVOKE.md](./DAILY_AUDIT_AGENT_INVOKE.md)  
**Automated Phase 1:** `npm run audit:daily`

---

## Context

PG Ride (People-Governed, `peoplegoverned.com` / Railway) is a community-owned rideshare PWA.

| Actor | Critical path |
|-------|----------------|
| **New rider** | Signup → email verify → **admin approve** → login → top-up Virtual PG Card (Stripe) → book ride |
| **New driver** | Signup → upload docs → **admin approve driver profile** → go online → accept → start → complete |
| **Active ride** | `pending` → `accepted` → arriving → `in_progress` → `completed` (payment + receipt) |
| **Payments** | Virtual card at driver acceptance; Stripe auth if balance low; cancellation fees; webhooks |
| **Real-time** | WebSocket `/ws` (status + location); ride chat; optional web push (VAPID) |
| **Safety** | SOS / emergency incidents; guardian links (`/guardian/:token`, `/emergency/:token`) |

---

## Phase 1 — Automated gates (run first)

```bash
npm run audit:daily
# or manually:
npm run check && npm test && npm run smoke:production
curl -s $BASE_URL/health/ready | jq
```

Flag any failure. Note warnings on: `0.5-stripe`, `0.2-public-url`, `0.7-domain`.

---

## Phase 2 — Production health

1. `/health` and `/health/ready` — DB, session, super admin, Stripe vars
2. `GET /api/payment/config` — Stripe enabled for top-up / card on file
3. Public routes — `/login`, `/signup`, `/privacy`, `/terms`
4. **Custom domain** — `peoplegoverned.com` must hit Railway app, not registrar parking
5. **Railway** — last deploy, failed builds, env drift vs `.env.example`

---

## Phase 3 — Rider daily failure modes

| Area | What can go wrong | Where to look |
|------|-------------------|---------------|
| **Onboarding** | Stuck: unverified email, pending approval | `[AUDIT] login_failed reason=pending_approval`, `email_not_verified`; `users.is_approved` |
| **Booking** | Can't book: low balance, no card, bad geocode | ride create, `/api/geocode`, nearby drivers |
| **Matching** | No drivers while drivers are online | `toggle-status`, counties, vehicle type filter |
| **Active ride** | Stale status / frozen driver dot | WebSocket `ride_status_update`, `useWebSocket.ts` |
| **Payment** | Wrong charge, stuck after complete, top-up fail | `splitDeductForRide`, Stripe intents, `payment_status` |
| **Cancellation** | Wrong fee or missing refund | 1.5mi/3min and 3mi/5min rules |
| **Chat** | Messages not delivered | `ride_messages`, WS `ride_message` |
| **Receipt** | Missing after complete | `/api/rides/:id/receipt` |
| **Promo/referral** | Welcome credit not applied | signup credits, `promoRidesRemaining` |

### Phase 3b — Scheduled & coworker rides (daily, mandatory)

Extends the manual journey in [PHASE_0_PRODUCTION.md](./PHASE_0_PRODUCTION.md) §0.6 (**A–C** = on-demand ride) with **E–F** every daily audit.  
**Minimum on `develop`:** trace APIs, UI entry points, and WebSocket types below. **When test accounts exist:** run the numbered steps and record PASS/FAIL in the report.

| Area | What can go wrong | Where to look |
|------|-------------------|---------------|
| **Solo schedule** | No `scheduledAt`; not on upcoming list | `ScheduleRideModal`, `GET /api/rides/scheduled` |
| **Driver board** | Open scheduled not visible / can't claim | `GET /api/driver/scheduled-rides`, `POST /api/driver/rides/:rideId/claim` |
| **Urgency** | No driver near departure | WS `new_scheduled_ride`, `scheduled_ride_claimed`, `scheduled_ride_taken`; `confirm-scheduled` |
| **Coworker group (Mode 4)** | No shift-end time; code join fails | `POST /api/rides/create-shared-schedule`, `POST /api/rides/join-schedule`, `SharedScheduleSheet` |
| **Group slots** | 4th joiner accepted; discount not applied | `maxSlots: 3`, `applyGroupDiscount`, `claimScheduleSlot` |
| **Group driver** | Claim only one seat; joiners orphaned | `assignDriverToSharedScheduleGroup`, group `status` |
| **Share invite** | Code not copy/shareable | Step 4 UI, clipboard / `navigator.share` |

See [SHIFT_WORKER_LAUNCH_PLAN.md](./SHIFT_WORKER_LAUNCH_PLAN.md).

#### E — Scheduled solo ride

**Rider**

1. Home → schedule (not “ride now”) → pick **future** date/time → pickup + destination in service area.
2. Confirm → ride appears under **Upcoming** with correct `scheduledAt`.
3. After a driver claims → rider sees driver name; near departure → **confirm** flow works (`confirm-scheduled`).

**Driver**

1. Go online → open **scheduled** board → solo row visible (one row per ride, not duplicated).
2. **Claim** open scheduled ride → rider gets WS `scheduled_ride_claimed`.
3. Other drivers see `scheduled_ride_taken` for that ride id.
4. At departure window → confirm/start → normal `accepted` → `in_progress` → `completed` lifecycle.

**Code / API checks (every audit)**

| Check | Evidence |
|-------|----------|
| Create path sets `scheduledAt` | `ScheduleRideModal` → ride create / schedule route |
| Rider list | `GET /api/rides/scheduled` includes ride + driver when claimed |
| Driver list | `GET /api/driver/scheduled-rides` — open + claimed upcoming |
| Claim | `POST /api/driver/rides/:rideId/claim` — solo uses `claimScheduledRide` |
| Confirm | `POST /api/driver/rides/:rideId/confirm-scheduled` |
| Broadcast | `new_scheduled_ride` on book; claim/taken WS payloads in `routes.ts` |

**Fail if:** future rides missing `scheduledAt`; claimed scheduled stuck without driver assignment; confirm-scheduled 500s; duplicate rows for the same group on driver board.

#### F — Coworker group schedule (Mode 4, `PG-XXXXXX`)

**Organizer (rider)**

1. **Ride home with coworkers** (or `SharedScheduleSheet`) → set **shift-end** date/time (required).
2. Pickup (job site) + destination (home) → create group → receive **`PG-XXXXXX`** code.
3. Copy or share code (clipboard / `navigator.share` if available).
4. Upcoming shows group ride at shared departure time.

**Coworker (joiner)**

1. **Join with code** (`JoinScheduleModal` / join CTA) → enter `PG-XXXXXX`.
2. Own pickup + destination → join succeeds; **inherits group `scheduledAt`**.
3. Upcoming lists joiner ride; when ≥2 riders → **30% discount** reflected on fare.
4. **4th joiner** must be rejected (max 3 people total including organizer).

**Driver**

1. Scheduled board shows **one row per coworker group** (not one row per seat).
2. **Claim** any seat in group → `assignDriverToSharedScheduleGroup` assigns **same driver to all group rides**; group locks (no new joiners).
3. All riders receive `scheduled_ride_claimed`; complete each leg or group flow as implemented.

**Code / API checks (every audit)**

| Check | Evidence |
|-------|----------|
| Create requires time | `create-shared-schedule` rejects missing `scheduledAt` |
| Join | `join-schedule` + `claimScheduleSlot` race handling |
| Open groups (optional) | `GET /api/rides/open-groups`, `POST .../open-groups/:id/join` |
| Group claim | `shared_schedule` branch on `POST /api/driver/rides/:rideId/claim` |
| UI | `RiderDashboard` coworker CTA, `UpcomingRideGroupCard`, driver `shared_schedule` chip |

**Fail if:** join without inherited `scheduledAt`; partial driver assignment across group; discount wrong at 2+ riders; group still accepting joiners after driver claim.

**Read-only DB patterns (if access):**

- `is_approved = false` users older than 48h
- Rides `accepted` / `in_progress` older than 4h
- `payment_status = 'authorized'` on completed rides
- `pending` rides older than 30min
- `ride_groups` where `group_type = 'shared_schedule'` and `filled_slots > max_slots`
- Joiner rides in a group with `scheduled_at` null while parent group has `scheduled_at` set

---

## Phase 4 — Driver daily failure modes

| Area | What can go wrong | Where to look |
|------|-------------------|---------------|
| **Approval** | Can't go online: docs pending / suspended | `driver_profiles.approval_status`, `toggle-status` |
| **Documents** | Upload fails (GCS vs DB fallback) | `/api/objects/upload`, `GCS_BUCKET_NAME` |
| **Online but idle** | Wrong counties, location not sent | `daily-session`, `track-location` |
| **Accept ride** | Race or payment auth fails → reverted pending | accept route + Stripe rollback |
| **Complete** | Earnings not credited | complete route, virtual card ledger |
| **Cash rides** | Awaiting payment queue stuck | `/api/rides/awaiting-payment` |

**Read-only DB patterns:**

- `driver_profiles.approval_status = 'pending'` count
- Online drivers with no location update 15+ min
- Completed rides with `pending_payment`

---

## Phase 5 — Safety & trust (P0)

Escalate immediately if found:

1. Unacknowledged **SOS / emergency_incidents**
2. **Guardian/SMS links** broken (`PUBLIC_APP_URL` wrong)
3. **CSRF / session** spikes (403 on login/signup)
4. **Account lockout** spike in audit logs
5. **Suspended** users still booking or driving

Files: `SOSModal`, `GuardianTrack`, `EmergencyTracking`, emergency routes in `server/routes.ts`.

---

## Phase 6 — Payments & Stripe

1. `/health/ready` → `0.5-stripe` should be **pass** when cards are live
2. Webhook delivery failures (Stripe Dashboard if available)
3. Idempotency: `claimWebhookEvent` on `/api/webhooks/stripe`
4. Stuck: `payment_intent.payment_failed` handling
5. Top-up: `create-intent` → `confirm` → ledger balance match

User symptoms: blank card form (`VITE_STRIPE_PUBLIC_KEY` + redeploy), ride cancelled right after accept.

See [STRIPE_SETUP.md](./STRIPE_SETUP.md).

---

## Phase 7 — Admin backlog

| Queue | Risk |
|-------|------|
| Rider approvals | New signups blocked |
| Driver doc review | Drivers can't earn |
| Disputes | Trust / chargebacks |
| Lost & found | Support load |

---

## Phase 8 — Code regression (weekly or after merges)

1. `npm test` — new failures?
2. Grep `TODO` / `FIXME` in ride, payment, auth paths
3. Recent PRs touching `routes.ts`, `storage.ts`, dashboards, Stripe, WS
4. `npm run check:migration-drift`

---

## Phase 9 — Real-time & mobile

| Check | Symptom |
|-------|---------|
| WebSocket `/ws` | No live updates |
| Service worker | Push silent |
| PWA install | Add to Home Screen broken |
| Capacitor | Wrong `CAPACITOR_SERVER_URL` |
| Geolocation | Booking without pickup |

---

## Required report format

```markdown
# PG Ride Daily Audit — YYYY-MM-DD

## Summary
- Overall: GREEN / YELLOW / RED
- **develop ↔ main parity:** (0 ahead / 0 behind, or explain skew)
- **Promote develop → main:** READY / NOT READY / N/A (already aligned)
- Biggest risk to riders or drivers today: …

## Automated gates
- audit:daily / check / test / smoke: …
- /health/ready: …

## Phase 3b — Scheduled & coworker (E / F)
- **E — Solo schedule:** PASS / FAIL / CODE-ONLY (note what was traced or manually tested)
- **F — Coworker group (`PG-XXXXXX`):** PASS / FAIL / CODE-ONLY
- Blockers or regressions: …

## P0 — Fix today
- …

## P1 — User-blocking
- …

## P2 — Degraded experience
- …

## Backlog metrics
- Pending rider approvals: N
- Pending driver approvals: N
- Stuck active rides: N
- Payment anomalies: N

## Recommended actions
| Priority | Action | Owner |
|----------|--------|-------|

## Areas checked clean
- …
```

**Severity:**

- **P0** — Safety, wrong payments, stuck mid-ride, auth outage
- **P1** — Onboarding blocked, Stripe down, domain broken, approval queue > 24h
- **P2** — Chat, maps, push, minor UI

---

## Agent rules

1. **Read-only** on production DB unless authorized
2. **Never** log secrets (Stripe, `SESSION_SECRET`)
3. Cite evidence: route, log tag, query count, curl output
4. **Branching (mandatory):** Audit and test on **`develop`**. Fix branches from **`develop`**. **Draft PRs base `develop`**. Promote **`develop` → `main`** only after audit + founder sign-off. After promote, **`develop` and `main` should match** — report parity each run. See [GIT_WORKFLOW.md](./GIT_WORKFLOW.md)
5. Code fixes: `git checkout develop && git pull` → `cursor/daily-audit-YYYYMMDD-a737` → **draft PR → `develop`**
6. Tag findings: `[RIDER]` `[DRIVER]` `[ADMIN]` `[PAYMENT]` `[SAFETY]` `[INFRA]`

---

## Reference

| Resource | Path |
|----------|------|
| **Git workflow (develop → main)** | [GIT_WORKFLOW.md](./GIT_WORKFLOW.md) |
| Shift / coworker rides | [SHIFT_WORKER_LAUNCH_PLAN.md](./SHIFT_WORKER_LAUNCH_PLAN.md) |
| UX assessment | [USER_FRIENDLINESS_ASSESSMENT.md](./USER_FRIENDLINESS_ASSESSMENT.md) |
| Invoke prompt | [DAILY_AUDIT_AGENT_INVOKE.md](./DAILY_AUDIT_AGENT_INVOKE.md) |
| Audit report archive | [audits/README.md](./audits/README.md) |
| Phase 0 / production | [PHASE_0_PRODUCTION.md](./PHASE_0_PRODUCTION.md) |
| Stripe | [STRIPE_SETUP.md](./STRIPE_SETUP.md) |
| Product | [MASTER_PLAN.md](./MASTER_PLAN.md) |
| Production URL | `https://nbhoodride-production.up.railway.app` |
| Target domain | `https://peoplegoverned.com` |
