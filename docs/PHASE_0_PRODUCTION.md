# Phase 0 — Web Production Ready

**Goal:** A stranger can sign up, get approved, book a ride, and pay on the live URL.  
**Blocks:** App Store Phase 1+ until this checklist is green.  
**Parent plan:** [APP_STORE_PLAN.md](./APP_STORE_PLAN.md) § Phase 0

**Production URL:** https://nbhoodride-production.up.railway.app

---

## Quick status (automated)

```bash
# Public route smoke (works against live deploy today)
npm run smoke:production

# Server-side readiness (after deploy includes /health/ready)
curl -s https://nbhoodride-production.up.railway.app/health/ready | jq
```

`ready: true` means required engineering gates pass. Warnings (Stripe, custom domain, manual smoke) may remain.

---

## Checklist

| ID | Item | Owner | Status | Done when |
|----|------|-------|--------|-----------|
| **0.1** | Railway deploy (`DATABASE_URL`, `SESSION_SECRET`) | Track B | **Pass** | `/health` → `{"status":"ok"}` |
| **0.2** | `PUBLIC_APP_URL` canonical HTTPS | Track B | **Warn** | Railway default works; set custom domain before marketing |
| **0.3** | Super admin bootstrap | Track B | **Action needed** | `/admin/setup` + `SUPER_ADMIN_*` vars |
| **0.4** | Privacy + Terms public | Track A | **Pass** | `/privacy`, `/terms` → 200 |
| **0.5** | Stripe (if card payments at launch) | Track B | **Optional** | Test top-up with live keys |
| **0.6** | E2E ride smoke test | Both | **Manual** | See script below |
| **0.7** | Custom domain DNS | Track B | **Not started** | `pgride.com` / `pgride.app` → Railway |

*Re-run `npm run smoke:production` after each deploy to refresh status.*

---

## 0.1 — Railway deploy

Minimum variables on the app service ([TRACK_B_CREDENTIALS.md](./TRACK_B_CREDENTIALS.md)):

```bash
DATABASE_URL=          # Railway Postgres reference
SESSION_SECRET=        # openssl rand -hex 32
PUBLIC_APP_URL=https://nbhoodride-production.up.railway.app
```

Deploy from repo root:

```bash
railway login
railway link --project <your-project>
railway up --detach -m "deploy main"
```

Verify:

```bash
curl -s https://nbhoodride-production.up.railway.app/health
```

---

## 0.2 — PUBLIC_APP_URL

Set to the URL users will bookmark and stores will load:

| Stage | Value |
|-------|-------|
| **Now** | `https://nbhoodride-production.up.railway.app` |
| **Launch** | `https://pgride.com` (after DNS + SSL) |

`resolveAppUrl()` also accepts `APP_URL` or auto-set `RAILWAY_PUBLIC_DOMAIN`.

**Verify:** Guardian or email links use `https://` and the correct host (not a bare hostname).

---

## 0.3 — Super admin bootstrap

1. Set in Railway → Variables:
   - `SUPER_ADMIN_SETUP_TOKEN` — random one-time string (`openssl rand -hex 16`)
   - `SUPER_ADMIN_EMAIL` — your admin email

2. Open **https://nbhoodride-production.up.railway.app/admin/setup**

3. Enter token + set password

4. Log in at `/login` → open `/admin` → approve test users

5. **Remove or rotate** `SUPER_ADMIN_SETUP_TOKEN` after bootstrap

**Verify:** `curl -s .../health/ready | jq '.checks[] | select(.id=="0.3-super-admin")'`

---

## 0.4 — Legal pages

Already shipped (SPA routes):

- https://nbhoodride-production.up.railway.app/privacy
- https://nbhoodride-production.up.railway.app/terms

Required for App Store / Play listing URLs.

---

## 0.5 — Stripe (optional for soft launch)

Required only if marketing card top-up at launch:

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server |
| `VITE_STRIPE_PUBLIC_KEY` | Client checkout |
| `STRIPE_WEBHOOK_SECRET` | Payment confirmations |

**Verify:** Log in → Payments → add test card (Stripe test mode) → top-up Virtual PG Card.

Cash / virtual-only rides work without Stripe.

---

## 0.6 — Manual E2E smoke script

Run once after super admin exists. Use two browsers or incognito windows.

### A — Rider path

1. `/signup` — create rider account (Maryland address)
2. Admin `/admin` — **approve** rider
3. Rider login → add Virtual PG Card funds (or Stripe test top-up)
4. Home → book ride (pickup + destination in PG County)
5. Confirm fare → request ride

### B — Driver path

1. `/signup` — create driver account + upload docs (or admin bypass if test)
2. Admin — **approve** driver
3. Driver login → go **online** → accept pending ride
4. Start ride → complete ride

### C — Receipt & safety

1. Rider sees completed ride + receipt modal
2. Open guardian/emergency tracking link from ride (if enabled)
3. Rider/driver chat on active ride (if applicable)

**Pass criteria:** No 500 errors; ride reaches `completed`; receipt visible.

**Scheduled & coworker (daily agent):** See [DAILY_AUDIT_PROMPT.md](./DAILY_AUDIT_PROMPT.md) Phase **3b — E / F** (solo schedule + `PG-XXXXXX` group rides).

Document result:

```text
Phase 0.6 smoke — YYYY-MM-DD
Tester:
Rider email:
Driver email:
Result: PASS / FAIL
Notes:
```

---

## 0.7 — Custom domain

1. Railway → Service → **Settings** → **Networking** → add custom domain
2. DNS at registrar:
   - `pgride.com` → CNAME to Railway target (or A record per Railway docs)
   - Repeat for `pgride.app` if desired
3. Update `PUBLIC_APP_URL=https://pgride.com`
4. Redeploy; verify SSL padlock
5. `npm run smoke:production` with `BASE_URL=https://pgride.com`

---

## Exit criteria (Phase 0 complete)

- [ ] `/health/ready` → `"ready": true`
- [ ] `npm run smoke:production` exits 0
- [ ] Super admin can approve users
- [ ] Manual 0.6 smoke script **PASS** recorded
- [ ] (Recommended) Custom domain live before public marketing
- [ ] (If card payments) Stripe test top-up succeeds

**Then proceed to:** [APP_STORE_PLAN.md](./APP_STORE_PLAN.md) Phase 1 (PWA polish).

---

## Track B action summary

| Priority | Action |
|----------|--------|
| **P0** | Complete `/admin/setup` if not done |
| **P0** | Run manual 0.6 smoke test; file any bugs |
| **P1** | Set `PUBLIC_APP_URL` explicitly in Railway |
| **P1** | Point `pgride.com` DNS to Railway |
| **P2** | Stripe keys if card launch |
| **P2** | `RESEND_API_KEY` for production email |

---

*Last audited: against `nbhoodride-production.up.railway.app` — health OK, legal OK, custom domain DNS pending.*
