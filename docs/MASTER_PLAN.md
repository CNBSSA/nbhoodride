# PG Ride — Master Plan

**Single source of truth** for product strategy, architecture, roadmap, marketing, and open work.

| Field | Value |
|-------|-------|
| **Product** | PG Ride — PG County Community Ride-Share Platform |
| **Document version** | 2.0 (consolidated) |
| **Last updated** | June 2026 |
| **Repository** | `nbhoodride` |
| **Supersedes** | `replit.md`, `PG_Ride_Marketing_Brief.md`, `docs/AH-060-tax-1099-w9-design.md`, and all `attached_assets/Pasted-*.txt` planning notes |
| **Future vision** | [`VISION_AI_NATIVE.md`](VISION_AI_NATIVE.md) — AI-native product blueprint |

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Mission, vision, and differentiators](#2-mission-vision-and-differentiators)
3. [User roles and community trust model](#3-user-roles-and-community-trust-model)
4. [Product roadmap](#4-product-roadmap)
5. [Current system architecture](#5-current-system-architecture)
6. [Features shipped](#6-features-shipped)
7. [Group ride modes](#7-group-ride-modes)
8. [Pricing and business model](#8-pricing-and-business-model)
9. [Cooperative ownership model](#9-cooperative-ownership-model)
10. [Safety](#10-safety)
11. [Brand and marketing](#11-brand-and-marketing)
12. [Go-to-market strategy](#12-go-to-market-strategy)
13. [Deployment and infrastructure](#13-deployment-and-infrastructure)
14. [Backlog and open work](#14-backlog-and-open-work)
15. [Tax compliance (AH-060)](#15-tax-compliance-ah-060)
16. [Metrics](#16-metrics)
17. [FAQ and elevator pitches](#17-faq-and-elevator-pitches)
18. [Contact](#18-contact)

**→ AI-native future vision:** [VISION_AI_NATIVE.md](VISION_AI_NATIVE.md)

---

## 1. Executive summary

PG Ride is a hyper-local, community-focused ride-sharing platform for **Prince George's County, Maryland**. It connects verified neighborhood drivers with local riders, emphasizing transparency, safety, and community trust — not anonymous scale.

Unlike Uber and Lyft, PG Ride offers:

- Verified PG County drivers (neighbors, not strangers)
- Transparent GPS-based pricing with **no surge fees**
- A **Virtual PG Card** digital wallet
- A **cooperative ownership model** where qualifying drivers earn equity and profit distributions

The app is a **Progressive Web App (PWA)** — mobile-first, no app-store download required. Originally prototyped on Replit; deploy target is **Railway** with Neon PostgreSQL.

---

## 2. Mission, vision, and differentiators

### Mission

Build a trusted, reliable, and fair mobility network *for* PG County, *by* PG County.

### Vision

Supplement public transit and compete with incumbent ride-share giants on **community trust** and a superior local experience — the "ride from your neighbor" service.

### Key differentiators

| Factor | Uber/Lyft | PG Ride |
|--------|-----------|---------|
| Driver identity | Anonymous | Verified neighbor |
| Surge pricing | Yes (2×–5×+) | Never |
| Driver commission | 25–40% platform cut | Drivers set own rates |
| Driver ownership | None | 49% profit pool for qualifying drivers |
| Geographic focus | Global | PG County only |
| Driver selection | Algorithm-assigned | Riders can request specific drivers by phone |
| Emergency tracking | Limited | Live shareable tracking link |
| Money stays local | No | Yes |

### Launch geography

Initial pilot zone: geo-fenced area within PG County (e.g. **Largo–Mitchellville–Woodmore corridor**). Expand gradually as driver supply grows.

---

## 3. User roles and community trust model

### Roles

Every user starts as a **Rider**. They may become a **Driver** after verification.

**Riders** — PG County residents who need local transportation.

- Sign up with email/password; admin approval required before first login
- Book immediate or scheduled rides; search drivers by proximity or phone number
- Pay via Virtual PG Card; track driver in real time; rate and tip; file disputes

**Drivers (Verified Neighbor Drivers)** — Vetted community members offering rides.

- Toggle online/offline; accept or decline requests
- GPS tracked in real time; earn to Virtual PG Card wallet
- Customize rate card; track ownership progress; request payouts

**Admins** — Approve users, manage disputes, payouts, finances, ownership, profit declarations.

**Super Admin** — Single hardcoded account (`thrynovainsights@gmail.com`): create admins, promote/demote, delete any user.

### How riders and drivers interact

1. **Discovery** — Rider sees nearby online drivers or searches by phone (community trust: request someone you know).
2. **Booking** — Pickup/destination entered; fare estimated from GPS distance + time; Virtual PG Card charged at driver acceptance.
3. **During ride** — Real-time GPS for both parties; in-app messaging; SOS always available.
4. **Completion** — Final fare from GPS waypoints; driver credited; rider rates driver.
5. **Safety net** — Disputes, cancellations (with fee rules), emergency tracking.

---

## 4. Product roadmap

### Phase 1 — Core MVP

| Item | Status |
|------|--------|
| Rider & driver sign-up, profiles, admin approval | ✅ Shipped |
| Driver document uploads (license, insurance, vehicle photos) | ✅ Shipped (storage needs Railway bucket — see §14) |
| Online/offline toggle, nearby drivers map | ✅ Shipped |
| Booking flow, fare estimate, real-time GPS | ✅ Shipped |
| Two-way ratings and reviews | ✅ Shipped |
| SOS emergency button | ✅ Shipped |
| Push notifications (accept, arriving, complete) | ✅ Shipped |
| Dispute resolution ("Report Issue") | ✅ Shipped |
| Driver earnings dashboard | ✅ Shipped |
| Precise pickup instructions | ⚠️ Partial / verify in UI |
| Detailed ride receipts | ⚠️ Partial / verify in ride history |

### Phase 2 — Beta polish

| Item | Status |
|------|--------|
| Multi-stop trips | ✅ Shipped (Mode 3) |
| Shared schedule / group codes | ✅ Shipped (Mode 4) |
| Admin console | ✅ Shipped |
| In-app chat with canned messages | ❌ Backlog |
| Lost & found workflow | ❌ Backlog |
| Favorite drivers | ❌ Backlog |

### Phase 3 — Growth and monetization

| Item | Status |
|------|--------|
| Digital payments (Stripe) | ✅ Shipped (top-up + card on file) |
| Virtual PG Card wallet | ✅ Shipped |
| Welcome credit + promo rides | ✅ Shipped ($20 + 4×$5 off) |
| Referral bonuses | ❌ Backlog |
| Driver "Pro" tiers / badges | ❌ Backlog |

### Phase 4 — Differentiators and scale

| Item | Status |
|------|--------|
| Cooperative ownership + profit distributions | ✅ Shipped |
| Scheduled rides | ✅ Shipped |
| AI assistant | ✅ Shipped |
| Analytics (heatmaps, scorecards, safety patterns) | ✅ Shipped |
| "Ride for a friend" | ❌ Backlog |
| Community routes | ❌ Backlog |
| Vehicle type selection | ❌ Backlog |

---

## 5. Current system architecture

### Frontend

React SPA — TypeScript, Vite, Shadcn/ui (Radix), Tailwind CSS, React Query, Wouter, Leaflet, Uppy.

Mobile-first PWA with bottom navigation: Home, Rides, Payments, Assistant, Profile.

### Backend

Node.js Express REST API. Drizzle ORM + **Neon serverless PostgreSQL**.

- Email/password auth, bcrypt, server-side sessions in PostgreSQL
- WebSockets for live ride tracking and messaging
- Rate limiting: 200 req/15 min general; 20/15 min auth; 10/min AI endpoints

### Data entities (PostgreSQL)

Users, driver profiles, vehicles, rides, ride groups, disputes, emergency incidents, sessions, payout requests, profit declarations, push subscriptions, conversations, event tracking, driver scorecards, and more (see `shared/schema.ts`).

### Object storage

Driver documents intended for **Google Cloud Storage** with custom ACL. On Railway today: `STORAGE_AVAILABLE = false` in `server/objectStorage.ts` — uploads return 503 until GCS/S3 is configured.

### Key environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL |
| `SESSION_SECRET` | Session signing |
| `STRIPE_SECRET_KEY` / `VITE_STRIPE_PUBLIC_KEY` | Payments |
| `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` | Web push |
| `SUPER_ADMIN_SETUP_TOKEN` | One-time super-admin bootstrap |
| `OPENAI_*` or Replit AI integration | AI assistant |

---

## 6. Features shipped

### Authentication and RBAC

Three-tier: Super Admin → Admin → Regular User (must be approved). Fields: `isSuperAdmin`, `isAdmin`, `isApproved`, `approvedBy`, `isSuspended`.

### Dynamic pricing (rate card)

Default suggested rates: **$4.00 base + $0.29/min + $0.90/mi**, min $7.65, max $100.00. Drivers customize via `/driver/rate-card` or use suggested rates. GPS waypoints every 5 seconds; final fare on completion.

### Virtual PG Card

- New users: $20 welcome credit + 4 promo rides ($5 off each)
- Top-up: `POST /api/virtual-card/topup/create-intent` → Stripe Elements → `POST /api/virtual-card/topup/confirm`
- Fare deducted at ride acceptance; cancellation fees per driver-travel rules

### Driver payouts

Withdraw via Zelle, Cash App, PayPal, or check (min $5). Amount held immediately; refunded if admin rejects. Admin queue at `/admin` Payouts tab.

### AI assistant

"PG Ride Assistant" — streaming OpenAI responses with user context (rides, balance, rating). Feedback thumbs up/down. Routes under `/api/ai/conversations`.

### Analytics and self-learning

Event tracking, AI feedback, driver scorecards, demand heatmap, safety pattern detection, FAQ auto-generation, platform insights. Driver insights at `/driver/insights`; admin Analytics tab.

### Admin back office (`/admin`)

Users, drivers, rides, disputes, payouts, finances, ownership, profit declarations, activity log.

### Legal

Terms (`/terms`) and Privacy (`/privacy`) — public, no login.

---

## 7. Group ride modes

Beyond solo and auto-matched shared rides:

### Mode 3 — Multi-Stop (`rideType: "multi_stop"`)

- Organizer adds 1–3 pickup stops + one shared destination
- **One payer** — full route fare on organizer's PG Card
- API: `POST /api/rides/multi-stop`
- UI: `MultiStopBookingSheet.tsx`
- Driver sees numbered stops on `IncomingRideRequest`

### Mode 4 — Shared Schedule (`rideType: "shared_schedule"`)

- Organizer books → receives **`PG-XXXXXX`** code (copy/SMS/WhatsApp)
- Up to 2 joiners enter code via `POST /api/rides/join-schedule`
- Each joiner has own pickup + destination
- **30% discount** for everyone (including organizer) when first joiner joins
- Join window closes when driver accepts
- Schedule codes expire 1 hour after scheduled pickup
- UI: `SharedScheduleSheet.tsx`, `JoinScheduleModal.tsx`

### Data model

`ride_groups` table: `scheduleCode`, `organizerId`, `groupType`, `maxSlots`, `filledSlots`, `status`, `driverId`, `discountActive`, `scheduledAt`.

`rides` fields: `groupId`, `rideType`, `pickupStops`, `originalFare`, `groupDiscountAmount`.

Payment timing: Virtual Card deduction at **driver acceptance**; server checks group size and applies discount if ≥2 riders.

---

## 8. Pricing and business model

### Example fare

10-minute, 5-mile ride = $4.00 + $2.90 + $4.50 = **$11.40**

Drivers may customize within platform bounds (e.g. per mile $0.25–$5.00).

### Revenue split (cooperative)

| Pool | Share |
|------|-------|
| Platform / founder | 51% of net profit |
| Driver-owners | 49% of net profit |

---

## 9. Cooperative ownership model

PG Ride's primary competitive advantage for driver recruitment.

1. Drive **40+ hours/week** with **4.85+** star rating → earn qualifying weeks
2. **Ad-Hoc Owner** (12 qualifying weeks) → Share Certificate + profit distributions
3. **Lifetime Owner** (5,640 total hours) → permanent equity + ongoing dividends

Drivers track progress on Ownership Dashboard; admin manages declarations and distributions.

---

## 10. Safety

- Verified PG County drivers (admin approval + document review)
- One-tap **SOS** during every ride
- Direct **911** integration
- Emergency contact SMS with **live tracking link** (no app required for viewer)
- Ride status pipeline: Pending → Accepted → Driver Arriving → In Progress → Completed
- Report & dispute system → admin review

---

## 11. Brand and marketing

### Identity

| Element | Details |
|---------|---------|
| **Name** | PG Ride |
| **Subtitle** | Community Rideshare |
| **Tagline** | "Your ride from neighbors, by neighbors." |
| **Primary** | Blue #2E86DE |
| **Secondary** | Green #2E7D32 |
| **Accent** | Orange/Gold #FF9800 |
| **Safety** | Red |
| **Font** | Inter (Google Fonts) |
| **Voice** | Warm, community-focused, trustworthy |

### Target audiences

**Riders** — Working adults, students, seniors, families. Pain: distrust of anonymous drivers, surge pricing. Message: *"Ride with people you trust. No surge fees. Ever."*

**Drivers** — Part/full-time gig workers in PG County. Pain: high platform cuts, no equity. Message: *"Drive for your community. Own a piece of the platform."*

### Screenshots

Development screenshots may live in `attached_assets/` for marketing reference. Contact admin for current high-res captures or live demo.

---

## 12. Go-to-market strategy

### Pre-launch

Recruit ~20 drivers from the pilot zone; personally onboard.

### Launch

Grassroots marketing in pilot zone for first 100–200 riders: Metro stations, community centers, local Facebook/NextDoor groups.

### Growth

Local business partnerships; expand geo-fence as supply grows; university outreach (UMD, Bowie State); senior centers.

### Channels

| Channel | Theme |
|---------|-------|
| Facebook / Instagram | Trust & safety |
| TikTok | Driver ownership stories |
| NextDoor | Local economy |
| Flyers | Simplicity — no surge, verified neighbors |

### Launch action items (marketing)

1. Finalize brand assets and social templates
2. Driver recruitment materials (ownership + rate cards)
3. Rider acquisition materials (safety, no surge)
4. Social accounts (Facebook, Instagram, TikTok)
5. Community launch events (3–5 local partners)
6. Referral tracking
7. Driver testimonial videos

---

## 13. Deployment and infrastructure

### Railway (`railway.toml`)

- Build: `npm run build`
- Pre-deploy: `npm run db:push`
- Start: `npm run start`
- Health: `GET /health`

### Quality gates

```bash
npm run check   # migration drift + tsc
npm test        # vitest
```

### Migration from Replit

Original stack was Replit-first (auth, AI integrations, GCS via Replit sidecar). Railway deployment requires:

- Neon `DATABASE_URL` (replaces Replit DB)
- Object storage wired to GCS or S3 (not Replit sidecar)
- Env vars set in Railway → Variables (no hardcoded secrets)

---

## 14. Backlog and open work

### Infrastructure (blocking production)

| Item | Priority | Notes |
|------|----------|-------|
| Object storage on Railway | **P0** | `STORAGE_AVAILABLE = false`; driver doc uploads return 503 |
| GCS/S3 env vars + `objectStorage.ts` implementation | **P0** | `@google-cloud/storage` in deps, not connected |

### Product polish (from gap analysis)

| Feature | Phase | Status |
|---------|-------|--------|
| In-app chat with canned messages | Beta | ❌ |
| Lost & found workflow | Beta | ❌ |
| Favorite drivers | Beta | ❌ |
| Referral program | Growth | ❌ |
| Ride for a friend | Scale | ❌ |
| Community routes | Scale | ❌ |
| Vehicle type selection | Scale | ❌ |

### Compliance

See [§15 Tax compliance](#15-tax-compliance-ah-060) — not yet implemented.

---

## 15. Tax compliance (AH-060)

**Status:** Design only — **not implemented**.

**Risk:** IRS non-compliance when any driver earns ≥$600/year. Penalties ~$310 per missed/late 1099-NEC form.

### IRS requirements (summary)

For each driver paid **≥$600/calendar year**:

1. Collect **W-9** (legal name, tax classification, address, TIN, signature)
2. Validate TIN (format minimum; IRS matching ideal)
3. Track gross payments per driver per year (rides, tips, bonuses, 1099-able profit distributions)
4. Issue **1099-NEC** by Jan 31 to driver and IRS
5. Backup withhold **24%** if TIN missing or IRS mismatch

### Implementation paths

| Path | Summary | Effort |
|------|---------|--------|
| **A — Stripe Connect** (recommended if Stripe-native) | Stripe handles W-9 + 1099 via Connect Tax Reporting | ~1 week; requires payout migration |
| **B — Tax1099 / third-party API** | Keep Zelle/CashApp/PayPal/check payouts; own W-9 UI + year-end filing API | ~2–3 weeks |
| **C — Manual** | W-9 PDF upload + admin IRIS filing | ~1 week eng + annual admin labor; only viable <50 drivers |

**Recommendation:** Path A if committed to Stripe end-to-end; Path B if keeping multi-channel payouts.

**Blocking:** Business decision on path. Engage CPA before shipping.

**Open questions:**

1. How many drivers projected ≥$600 in 2026?
2. Payout channel split (Zelle vs CashApp vs PayPal vs check)?
3. Are `profit_distributions` 1099-able or K-1/partnership?
4. Confirm Maryland CF/SF participation for 1099-NEC each tax year.

---

## 16. Metrics

| Metric | Why |
|--------|-----|
| Rider sign-ups | Growth |
| Driver sign-ups | Supply |
| Rides completed / week | Activity |
| Monthly active riders | Retention |
| Driver qualifying week rate | Ownership pipeline |
| Average fare | Revenue baseline |
| Rider NPS / satisfaction | Word of mouth |
| Referral conversion | Organic growth |

---

## 17. FAQ and elevator pitches

### FAQ

**Available outside PG County?** No — PG County residents only.

**App store download?** No — PWA at the deployed URL; add to home screen for app-like experience.

**vs Uber/Lyft pricing?** No surge; ~$11.40 for a typical 5-mile ride.

**How do drivers become owners?** 40+ hrs/week, 4.85+ rating → 12 qualifying weeks → Share Certificate + profit share.

**Safe?** Verified drivers, SOS, 911, live tracking link for family.

**Choose your driver?** Yes — search by phone number.

### Pitches

**Riders (15s):** "PG Ride is the rideshare app made for PG County. You ride with verified neighbors — not strangers. There's never surge pricing, and every dollar stays in the community."

**Drivers (15s):** "PG Ride lets you drive for your own community and actually own a piece of the platform. Set your own rates, earn equity, and get profit-sharing — not just a paycheck."

**General (30s):** "PG Ride is the first community-owned rideshare platform, built exclusively for Prince George's County, Maryland. Riders get verified neighborhood drivers with transparent pricing — no surge fees, ever. Drivers set their own rates and earn real equity through our cooperative ownership model, with 49% of platform profits going back to qualifying driver-owners. It's not just a ride. It's your community, moving together."

---

## 18. Contact

- **Admin email:** thrynovainsights@gmail.com
- **Tech stack:** React, Node.js, PostgreSQL (Neon), Railway
- **Schema source of truth:** `shared/schema.ts`
- **Deploy config:** `railway.toml`

---

*This document consolidates all prior planning artifacts. Update this file when roadmap, architecture, or GTM strategy changes.*
