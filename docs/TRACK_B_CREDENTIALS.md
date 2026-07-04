# Track B — Credentials & API keys inventory

**Purpose:** Single table of everything PG Ride needs from you to go fully live. Code is wired env-gated — development continues without these.

**Where to set:** Railway → Project → Variables (copy from [`.env.example`](../.env.example)).

**Status legend:**

| Status | Meaning |
|--------|---------|
| **Required** | App won't deploy/run without it |
| **Wired** | Code ready; feature inactive until set |
| **Optional** | Nice-to-have; graceful fallback |
| **Decision** | Business/board choice, not a secret |

---

## Master inventory

| Variable / credential | Purpose | Status | When you need it | Feature unlocked |
|----------------------|---------|--------|------------------|------------------|
| `DATABASE_URL` | Neon PostgreSQL connection | **Required** | Before any deploy | All data |
| `SESSION_SECRET` | Session cookie signing | **Required** | Before deploy | Login / auth |
| `STRIPE_SECRET_KEY` | Server-side Stripe | **Wired** | Before card payments live | Virtual card top-up, ride auth |
| `VITE_STRIPE_PUBLIC_KEY` | Client Stripe.js | **Wired** | Before card payments live | Checkout UI |
| `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhooks | **Wired** | Before production payments | Payment confirmations |
| `ANTHROPIC_API_KEY` | AI assistant + orchestrator | **Wired** | Before AI chat live | Mobility intent, FAQ gen |
| `MAPBOX_TOKEN` | Mapbox geocoding + directions | **Wired** | Before real launch volume | Better US address autocomplete (`/api/geocode/suggest`) + driving routes (`/api/route`) |
| `GCS_BUCKET_NAME` | Driver document storage | **Wired** | Before doc uploads live | License/insurance uploads |
| `GOOGLE_APPLICATION_CREDENTIALS` or Railway GCS plugin | GCS auth | **Wired** | With GCS bucket | Object storage |
| `GCS_PRIVATE_PREFIX` | Private object path prefix | **Wired** | With GCS (default set) | Doc ACL paths |
| `VAPID_PUBLIC_KEY` | Web push (server) | **Optional** | Before push notifications | Ride alerts, nudges |
| `VAPID_PRIVATE_KEY` | Web push signing | **Optional** | Before push notifications | Push delivery |
| `VAPID_EMAIL` | VAPID contact | **Optional** | With VAPID keys | Push registration |
| `VITE_VAPID_PUBLIC_KEY` | Web push (client) | **Optional** | Before push notifications | Browser subscribe |
| `TWILIO_ACCOUNT_SID` | SMS provider | **Optional** | Before SMS booking / SOS SMS | E4 SMS inbound, tracking links |
| `TWILIO_AUTH_TOKEN` | Twilio auth | **Optional** | With Twilio | SMS send/receive |
| `TWILIO_PHONE_NUMBER` | Twilio from-number | **Optional** | With Twilio | SMS from PG Ride |
| `RESEND_API_KEY` | Transactional email | **Optional** | Before production email | Signup, receipts, approvals |
| `RESEND_FROM` | From address (verified domain) | **Optional** | With Resend | Email deliverability |
| `PUBLIC_APP_URL` | Canonical app URL | **Wired** | Before guardian/SMS links in prod | Tracking share links |
| `APP_URL` | Fallback app URL (email service) | **Optional** | Email links | Email CTAs |
| `RAILWAY_PUBLIC_DOMAIN` | Auto-set on Railway | **Optional** | Railway deploy | OAuth redirects, emails |
| `SUPER_ADMIN_SETUP_TOKEN` | One-time bootstrap | **Required** (once) | First admin setup | Create super admin |
| `SUPER_ADMIN_EMAIL` | Super admin identity | **Wired** | Admin bootstrap | Super admin gate |
| `CHECKR_API_KEY` | Background checks | **Optional** | Driver approval automation | Checkr integration |
| `CHECKR_WEBHOOK_SECRET` | Checkr webhooks | **Optional** | With Checkr | BG check status updates |
| `WMATA_API_KEY` | WMATA incidents API | **Optional** | Live transit alerts | F3 real-time Metro delays |
| `TAX_COMPLIANCE_PATH` | W-9 / 1099 path | **Decision** | Before tax season | `path_a_stripe` \| `path_b_tax1099` \| `path_c_manual` |
| `ALLOWED_ORIGINS` | CORS allowlist | **Optional** | Multi-domain deploy | Cross-origin API |
| `ENABLE_TEST_LOGIN` | Dev test login | **Optional** | Local/dev only | Test accounts |
| `TEST_PASSWORD` / `TEST_USER_IDS` | Dev test creds | **Optional** | Local/dev only | QA login |

---

## Business decisions (not env vars)

| Item | Options | Blocks |
|------|---------|--------|
| AH-060 tax compliance | Path A (Stripe Connect) / B (Tax1099) / C (manual) | 1099 issuance at scale |
| Profit declarations | Board-approved amounts | Driver profit distributions |
| Green bonus pool funding | Board/community funding level | EV incentive payouts |
| WMATA / transit partnerships | Org data beyond public API | Anchor-specific alerts |
| Marketing launch | Channels, spend | Growth — not engineering |
| PR merge / Railway deploy | Your approval | Production release |

---

## What's already built without your keys

| Area | Behavior without keys |
|------|------------------------|
| Transit (F3) | Seeded PG County alerts |
| Object storage | Uploads return 503; code path exists |
| SMS booking | Inbound route exists; Twilio gated |
| Push | Bell UI works; no push until VAPID |
| AI assistant | Falls back or errors gracefully |
| Maps (autocomplete + routes) | Free OpenStreetMap fallback (Nominatim + OSRM demo) — works, lower quality than Mapbox |
| Stripe | Cash/virtual-only paths where applicable |
| Checkr | Manual driver approval flow |

---

## Your action checklist (when ready)

### Railway deploy (from repo root)

1. **Authenticate:** `railway login` (or `railway up -y` signs in + deploys in one step)
2. **Link project** (if existing): `railway link --project <name>` — or `railway up -y` creates project + service
3. **Add Postgres:** Railway dashboard → **+ New** → **Database** → **PostgreSQL** — copy `DATABASE_URL` into app service variables
4. **Minimum variables** on the app service:

| Variable | How to set |
|----------|------------|
| `DATABASE_URL` | From Railway Postgres service (reference variable) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `SUPER_ADMIN_SETUP_TOKEN` | One-time random string; hit setup route then remove |
| `SUPER_ADMIN_EMAIL` | Your admin email |
| `PUBLIC_APP_URL` | Railway public domain, e.g. `https://<app>.up.railway.app` |

5. **Deploy:** `railway up --detach -m "deploy main"` — `railway.toml` runs `npm run db:push` pre-deploy
6. **Verify:** open `/health`, then login/signup smoke test
7. **Next vars** (when ready): Stripe, `MAPBOX_TOKEN`, VAPID, `GCS_BUCKET_NAME`, `ANTHROPIC_API_KEY` — see table above

### Feature flip checklist

1. **Deploy minimum:** `DATABASE_URL`, `SESSION_SECRET`, `SUPER_ADMIN_SETUP_TOKEN`
2. **Payments:** Stripe keys + webhook secret
3. **Driver docs:** GCS bucket + credentials
4. **Comms:** Resend (email), Twilio (SMS), VAPID (push) — pick what you want live first
5. **Maps:** `MAPBOX_TOKEN` from [mapbox.com](https://account.mapbox.com/) — recommended before real launch volume
6. **Transit:** `WMATA_API_KEY` from [WMATA developer portal](https://developer.wmata.com/)
7. **Tax:** Choose `TAX_COMPLIANCE_PATH` with CPA input

### App stores (iOS + Android)

**Plan first:** [APP_STORE_PLAN.md](./APP_STORE_PLAN.md) — web production → PWA polish → Capacitor → listing → submit.  
**Build runbook (Phase 2+):** [APP_STORE_READINESS.md](./APP_STORE_READINESS.md)

| Item | Action |
|------|--------|
| Apple Developer Program | Enroll at developer.apple.com ($99/yr) |
| Google Play Console | Create developer account ($25 one-time) |
| `PUBLIC_APP_URL` | Set canonical HTTPS URL before store marketing |
| `CAPACITOR_SERVER_URL` | Optional — override URL baked into native shell |
| Signing keys | Xcode (iOS) + Android Studio keystore (you hold secrets — not in repo) |
| Store screenshots | Replace placeholders with real device captures before submission |
| Test accounts | Rider + driver credentials for Apple/Google review |

Engineering: `npm run build:mobile` → open Android Studio / Xcode → signed release upload.

*Update this file when new integrations ship. Track A agents add rows here; you flip variables in Railway.*
