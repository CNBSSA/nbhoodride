# PG Ride — Master Plan

> ### *"Movement is dignity. PG Ride exists to make every neighbor's movement effortless, fair, and safe — by building the first rideshare that thinks with you, not for you, and never against you."*

---

## 🌅 Mission

Build the world's first **community-owned, AI-native rideshare** — a mobility network where every match feels personal, every fare feels fair, every ride feels safe, and every driver shares in what they help build.

We are not iterating on Uber. We are not cloning Lyft. We are creating a category that has not existed before: a rideshare where **the community is the algorithm**, **AI is the steward (never the master)**, and **the profit is shared with the people who power it**.

---

## 🌠 Vision

By 2030, PG Ride is how Prince George's County moves.

- **Riders** delegate intent — *"get Mom to dialysis Thursday at 7:15"* — and the platform handles the rest, transparently and lovingly.
- **Drivers** earn equity in the platform they power, coached by an AI that helps them work smarter, not longer.
- **Families** trust the app because every ride is explainable, every match is a neighbor (or one degree away), and every emergency is one tap from real help.
- **The county** uses PG Ride as everyday infrastructure — knitting churches, campuses, hospitals, Metro corridors, and senior centers into a single, calm, neighborly network.

> **One-sentence promise:** PG Ride is what rideshare should have been from day one — built by neighbors, owned by drivers, guided by AI, and trusted by the community.

---

## ⚓ Founding Promises (read this before anything else)

These are the seven commitments PG Ride will not break. Every product, design, and engineering decision is measured against them. If we are tempted to break one, we change direction instead.

1. **No surge. Ever.** Demand is balanced by community supply and an AI-managed bonus pool — never by punishing riders when they need a ride most.
2. **No anonymous matching.** Every driver is a verified neighbor; every match comes with a reason a 78-year-old grandmother can understand in one tap.
3. **No hidden algorithms.** Every AI decision is explainable in plain language — riders see *"why this driver?"*; drivers see *"why this nudge?"*; admins see *"why this insight?"*. Every agent action is audit-logged.
4. **No data sold.** Rider location, drive patterns, contacts — never for sale, never for ads, never bundled to partners.
5. **No driver-as-input.** Drivers are owners-in-waiting. 49% of net profit goes to qualifying driver-owners; they share in what they build.
6. **No exclusion.** Voice booking, SMS fallback, large touch targets, multilingual surfaces — seniors, non-smartphone households, and non-English speakers are first-class users from day one.
7. **No false urgency.** Calm surface. Slow notifications. Quiet hours respected. Movement should feel like breathing, not bargaining.

---

## 🌟 What "AI-Native" Actually Means Here

Most apps that claim "AI-native" mean a chatbot bolted onto a 2015 interface. PG Ride means something fundamentally different.

| Legacy rideshare | PG Ride (AI-native) |
|---|---|
| Users navigate screens | Users state intent — *"ride home like last Tuesday"* |
| Algorithms decide silently | Agents propose; humans confirm; every action is logged |
| One static UI per role | Generative UI — the right card for the right moment |
| Surge = scarcity tax on riders | Bonus pool = community subsidy for drivers |
| Generic notifications | Context-aware (quiet hours, prayer time, school pickup) |
| Anonymous everything | Trust graph: 1st- and 2nd-degree neighbor matching |
| Apps make you do work | The platform takes work off your shoulders |
| Surveillance dressed as personalization | Memory you can read, edit, and delete |

The full technical expression of this is in **[Part II](#part-ii--ai-native-future-vision)**. The short answer for non-engineers: we make the easy things invisible and the important things obvious.

---

## 🧭 How to Read This Document

| If you are… | Start at |
|---|---|
| A first-time reader | This banner, then [§2 Mission, vision, differentiators](#2-mission-vision-and-differentiators), then [§22 The experience in 2030](#22-the-experience-in-2030) |
| An engineer | [§5 Current architecture](#5-current-system-architecture), [§23 Multi-agent architecture](#23-multi-agent-architecture), [§30 Future technical architecture](#30-future-technical-architecture) |
| A driver / driver-recruiter | [§9 Cooperative ownership](#9-cooperative-ownership-model), [§27 Economic intelligence](#27-economic-intelligence) |
| A rider / safety advocate | [§10 Safety](#10-safety), [§26 Safety intelligence](#26-safety-intelligence) |
| A marketer or partner | [§11 Brand and marketing](#11-brand-and-marketing), [§12 Go-to-market](#12-go-to-market-strategy) |
| An investor / cooperative steward | [§8 Pricing and business model](#8-pricing-and-business-model), [§9 Cooperative ownership](#9-cooperative-ownership-model), [§35 Competitive positioning](#35-competitive-positioning) |
| The founder on a tired evening | [§34 Explicit non-goals](#34-explicit-non-goals) — the things we say no to are how we keep the soul |

---

| Field | Value |
|-------|-------|
| **Product** | PG Ride — PG County Community Ride-Share Platform |
| **Document version** | 3.1 (mission-first, AI-native rewrite) |
| **Last updated** | June 2026 |
| **Repository** | `nbhoodride` |
| **Execution tracks** | [`EXECUTION_TRACKS.md`](EXECUTION_TRACKS.md) — autonomous vs gated work |
| **Supersedes** | All prior planning artifacts including `VISION_AI_NATIVE.md`, marketing brief, and pasted notes |
| **Two-part structure** | **Part I** = today's operational truth (shipped, deployed, in backlog). **Part II** = the 18–36 month AI-native future. The Founding Promises above govern both. |

---

## Table of Contents

### Part I — Current State

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

### Part II — AI-Native Future Vision (18–36 month horizon)

19. [North star (AI-native)](#19-north-star-ai-native)
20. [Design philosophy](#20-design-philosophy)
21. [What AI-native means](#21-what-ai-native-means-for-pg-ride)
22. [The experience in 2030](#22-the-experience-in-2030)
23. [Multi-agent architecture](#23-multi-agent-architecture)
24. [Interface evolution](#24-interface-evolution)
25. [Trust graph and social mobility](#25-trust-graph-and-social-mobility)
26. [Safety intelligence](#26-safety-intelligence)
27. [Economic intelligence](#27-economic-intelligence)
28. [Predictive operations](#28-predictive-operations)
29. [Ambient and multimodal UX](#29-ambient-and-multimodal-ux)
30. [Future technical architecture](#30-future-technical-architecture)
31. [Data and AI infrastructure](#31-data-and-ai-infrastructure)
32. [AI implementation roadmap](#32-ai-implementation-roadmap)
33. [AI success metrics](#33-ai-success-metrics)
34. [Explicit non-goals](#34-explicit-non-goals)
35. [Competitive positioning](#35-competitive-positioning)

### Appendices

- [Appendix A — Immediate next sprint](#appendix-a--immediate-next-sprint-from-current-codebase)
- [Appendix B — Reference research](#appendix-b--reference-research)
- [Appendix C — Soul metrics (qualitative)](#appendix-c--soul-metrics-qualitative)

---

# Part I — Current State

*Operational truth: what is shipped, deployed, and in backlog today.*

---

## 1. Executive summary

PG Ride is a hyper-local, community-focused ride-sharing platform for **Prince George's County, Maryland**. It connects verified neighborhood drivers with local riders, emphasizing transparency, safety, and community trust — not anonymous scale.

Unlike Uber and Lyft, PG Ride offers:

- Verified PG County drivers (neighbors, not strangers)
- Transparent GPS-based pricing with **no surge fees**
- A **Virtual PG Card** digital wallet
- A **cooperative ownership model** where qualifying drivers earn equity and profit distributions

The app is a **Progressive Web App (PWA)** — mobile-first, no app-store download required. Originally prototyped on Replit; deploy target is **Railway** with Neon PostgreSQL.

The vision (Part II) is to evolve PG Ride from a community rideshare into the **first AI-native, cooperative mobility network** — where intent replaces forms, agents replace dashboards, and the trust graph replaces opaque matching. We get there one promise-aligned shipment at a time.

---

## 2. Mission, vision, and differentiators

> The banner at the top of this document is the *elevator* version of this section — written for anyone arriving cold. This section is the *operational* version — written for anyone making product, hiring, or partnership decisions.

### Mission

Build a trusted, reliable, and fair mobility network *for* PG County, *by* PG County — and prove it can be done with AI as a steward instead of a surveillance layer.

### Vision

Supplement public transit and compete with incumbent ride-share giants on **community trust** and a superior local experience — the "ride from your neighbor" service. Over 18–36 months, evolve into an **AI-native** experience where users delegate intent and agents handle operations under transparent human oversight.

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
| AI surface | Chat in corner | Generative intent cards + agent mesh |
| Algorithm transparency | None | "Why this driver?" on every match |

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
| Detailed ride receipts | ✅ Shipped — API + RideReceiptModal [#59] |

### Phase 2 — Beta polish

| Item | Status |
|------|--------|
| Multi-stop trips | ✅ Shipped (Mode 3) |
| Shared schedule / group codes | ✅ Shipped (Mode 4) |
| Admin console | ✅ Shipped |
| In-app chat with canned messages | ✅ Shipped (quick messages — A4; not free-text chat) |
| Lost & found workflow | ✅ Shipped [#52](https://github.com/CNBSSA/nbhoodride/pull/52) |
| Favorite drivers | ✅ Shipped [#41](https://github.com/CNBSSA/nbhoodride/pull/41) |

### Phase 3 — Growth and monetization

| Item | Status |
|------|--------|
| Digital payments (Stripe) | ✅ Shipped (top-up + card on file) |
| Virtual PG Card wallet | ✅ Shipped |
| Welcome credit + promo rides | ✅ Shipped ($20 + 4×$5 off) |
| Referral bonuses | ✅ Shipped [#57](https://github.com/CNBSSA/nbhoodride/pull/57) |
| Driver "Pro" tiers / badges | ✅ Shipped [#57](https://github.com/CNBSSA/nbhoodride/pull/57) |

### Phase 4 — Differentiators and scale

| Item | Status |
|------|--------|
| Cooperative ownership + profit distributions | ✅ Shipped |
| Scheduled rides | ✅ Shipped |
| AI assistant | ✅ Shipped |
| Analytics (heatmaps, scorecards, safety patterns) | ✅ Shipped |
| "Ride for a friend" | ✅ Shipped [#54](https://github.com/CNBSSA/nbhoodride/pull/54) |
| Community routes | ✅ Shipped [#56](https://github.com/CNBSSA/nbhoodride/pull/56) |
| Vehicle type selection | ✅ Shipped [#56](https://github.com/CNBSSA/nbhoodride/pull/56) |

### Phase 5 — AI-native evolution (see Part II for the deep version)

| Item | Status |
|------|--------|
| Agent audit log + "Why this driver?" | ✅ Shipped [#38](https://github.com/CNBSSA/nbhoodride/pull/38) |
| RAG-powered assistant (pgvector) | ✅ Shipped [#39](https://github.com/CNBSSA/nbhoodride/pull/39) |
| Delegative intent cards + Generative UI | ✅ Shipped [#40](https://github.com/CNBSSA/nbhoodride/pull/40) |
| Trust graph + degrees-of-separation matching | ✅ Shipped [#41](https://github.com/CNBSSA/nbhoodride/pull/41) |
| Demand forecasting + Driver Earnings Coach | ✅ Shipped [#42](https://github.com/CNBSSA/nbhoodride/pull/42) |
| Voice booking + Guardian Mode + SMS fallback | ✅ Shipped [#40](https://github.com/CNBSSA/nbhoodride/pull/40), [#47](https://github.com/CNBSSA/nbhoodride/pull/47) |

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

This 49% pool is the structural expression of Founding Promise #5 ("No driver-as-input"). It is the single number that distinguishes PG Ride's economics from every Big Tech rideshare on Earth.

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
| In-app chat with canned messages | Beta | ✅ Quick messages (A4) + free-text ride chat |
| Lost & found workflow | Beta | ✅ [#52](https://github.com/CNBSSA/nbhoodride/pull/52) |
| Favorite drivers | Beta | ✅ [#41](https://github.com/CNBSSA/nbhoodride/pull/41) |
| Referral program | Growth | ✅ [#56](https://github.com/CNBSSA/nbhoodride/pull/56), [#57](https://github.com/CNBSSA/nbhoodride/pull/57) |
| Ride for a friend | Scale | ✅ [#54](https://github.com/CNBSSA/nbhoodride/pull/54) |
| Community routes | Scale | ✅ [#56](https://github.com/CNBSSA/nbhoodride/pull/56) |
| Vehicle type selection | Scale | ✅ [#56](https://github.com/CNBSSA/nbhoodride/pull/56) |

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

Qualitative companion metrics ("soul metrics") are catalogued in [Appendix C](#appendix-c--soul-metrics-qualitative).

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

**AI-native (45s, for tech investors):** "PG Ride is what rideshare would look like if it were designed in 2026 instead of 2010. Riders state intent — 'get Mom to dialysis' — and our multi-agent system handles trust-graph dispatch, fairness pricing, and safety monitoring under transparent human oversight. Drivers own 49% of the platform they power, coached by an AI that knows when not to push. We do this hyper-locally — Prince George's County, Maryland — because trust density is the moat that scale-first rideshare can never reclaim."

---

## 18. Contact

- **Admin email:** thrynovainsights@gmail.com
- **Tech stack:** React, Node.js, PostgreSQL (Neon), Railway
- **Schema source of truth:** `shared/schema.ts`
- **Deploy config:** `railway.toml`

---

# Part II — AI-Native Future Vision

*Horizon: 18–36 months. Builds on Part I (current shipped state). Governed by the Founding Promises at the top of this document.*

---

## 19. North star (AI-native)

> **PG Ride becomes the operating system for community movement in Prince George's County — where AI handles complexity so neighbors can simply move.**

We are not building another Uber with a chatbot bolted on. We are building the first **cooperative, hyper-local, AI-orchestrated mobility network** where:

- Riders **delegate intent** ("get Mom to her dialysis appointment Thursday at 7:15") instead of tapping through forms
- Drivers **delegate operations** ("maximize earnings between 4–9pm in Largo without burning out")
- The platform **delegates fairness** (no surge, but intelligent supply rebalancing and community subsidies)
- Ownership **delegates governance** (profit pools, qualifying weeks, and safety policy informed by transparent AI recommendations — never hidden algorithms)

**The feeling:** Calm, warm, inevitable. Like asking a trusted neighbor who happens to know every road, every driver, and every safe shortcut in PG County.

**The constraint:** Human drivers remain central for the foreseeable future. Autonomy is a research lane, not the product thesis. PG Ride wins on **trust density**, not sensor stacks.

---

## 20. Design philosophy

Three pillars govern every design decision:

### Pillar 1 — Community Soul

Technology serves PG County identity: churches, Metro corridors, HBCU campuses, senior centers, county fairs, neighbor referrals. The app should feel **local before it feels futuristic**. AI amplifies community bonds; it never replaces them with anonymous matching.

### Pillar 2 — Agent Brain

Behind a simple surface, specialized AI agents negotiate dispatch, pricing fairness, safety, scheduling, and support — continuously, invisibly, audibly logged. Users see outcomes, not machinery.

### Pillar 3 — Calm Surface

**Futuristic does not mean busy.** The best interface is often one adaptive card that says exactly what matters right now. No dashboards of dashboards. No chat-for-everything. Generative UI draws only what the moment needs.

```
┌─────────────────────────────────────────────────────────┐
│  CALM SURFACE          ←  what the rider sees (1 card)  │
├─────────────────────────────────────────────────────────┤
│  AGENT BRAIN           ←  12 agents coordinating        │
├─────────────────────────────────────────────────────────┤
│  COMMUNITY SOUL        ←  trust graph, co-op ownership  │
└─────────────────────────────────────────────────────────┘
```

---

## 21. What AI-native means for PG Ride

| Legacy rideshare | AI-native PG Ride |
|------------------|-------------------|
| User fills forms | User states intent |
| Static screens | Generative ride cards |
| Opaque matching | Explainable match ("Maria — 3 mutual neighbors, 4.9★") |
| Surge pricing | Community-balanced supply (no surge, ever) |
| Support tickets | Agent resolves 80% before human |
| Generic FAQ bot | Personal mobility copilot with memory |
| Driver guesses demand | Predictive shift coach |
| Admin dashboards | Insight agents with suggested actions |
| One-size notifications | Context-aware nudges (quiet hours, prayer time, school pickup) |

### Industry context (2026)

Uber and Lyft are investing in **agentic AI** for dispatch, mapping, and eventual L4 robotaxi fleets. Mobileye and NVIDIA are verticalizing autonomous ride-hail. Design research (robotaxi UX frameworks, passenger-first autonomy UI) emphasizes **trust through transparency** — clear state, next-action preview, reversible decisions.

PG Ride's differentiation: apply agentic orchestration to **human community drivers** first. We get 80% of the UX revolution without waiting for robotaxi regulation.

---

## 22. The experience in 2030

### 4.1 Rider — "Morning Maria"

Maria opens PG Ride. She does not see a map first. She sees **one card**:

> **Good morning, Maria.**  
> Church at 9:00 · usual driver James is online · **$11.40** (no surge)  
> [Ride with James] · [See 2 others] · [Just open map]

She taps once. James gets a request with her standing pickup note ("red jacket, bus stop side"). James accepts. Maria's husband receives the live tracking link automatically (saved preference).

On the ride, Maria says nothing — but if she long-presses the SOS area, a **Safety Agent** silently escalates: checks ride speed anomalies, route deviation, and offers one-tap 911 without false alarms.

After church, the app suggests (not demands):

> **Lunch?** Giant at Largo is 8 min away. 3 neighbors went this week.

Maria ignores it. The app learns — no spam.

### 4.2 Driver — "Evening James"

James toggles online. Instead of a blank waiting screen, he sees an **Earnings Horizon**:

> **4:00–7:00 PM forecast:** High demand near FedExField corridor.  
> **Suggested:** Stay in Largo until 5:30, then drift south.  
> **Ownership:** 2.3 hrs this week toward qualifying week #9.

A group ride request appears — **Shared Schedule PG-K7M2P**, 3 riders, combined $34.20 after community discount. The **Dispatch Agent** ranked this #1 because it fits his route home.

James accepts once. All three riders' fares settle. His ownership dashboard ticks forward.

### 4.3 Admin — "Co-op steward"

The admin does not read 40 charts. They read **three insight cards**:

1. 🔴 **Safety:** Unusual cancellation cluster on Route 202 corridor — review 4 rides
2. 🟡 **Supply:** Sunday morning church corridor understaffed — nudge 6 qualified drivers?
3. 🟢 **Ownership:** 2 drivers hit Ad-Hoc threshold this week — certificates ready

Each card has **[Approve action]** with full audit trail. AI proposes; humans approve.

### 4.4 Senior rider — voice-first

Miss Johnson, 78, never learned app navigation. She long-presses the home-screen PWA icon:

> "PG Ride, I need to go to the doctor on Tuesday."

The **Voice Agent** confirms address from history, reads fare aloud, books with her approved driver list, and texts her daughter the tracking link. Zero map interaction required.

### 4.5 Family — Guardian Mode

Maria's daughter Toya lives in DC. She enables Guardian on her mother's account. From then on:

- Every Maria ride auto-shares the tracking link to Toya
- A geofence pings Toya when Maria arrives at her cardiologist
- If the route deviates >500m or the car idles >10 minutes unexpectedly, Toya gets a call from the **Safety Agent** before any 911 escalation
- All of this is visible to Maria; she can pause Guardian for a single ride if she wants privacy

---

## 23. Multi-agent architecture

PG Ride evolves from a single Claude chat endpoint to a **Mobility Agent Mesh** — specialized agents with narrow permissions, shared context, and human escalation paths.

```
                    ┌─────────────────────┐
                    │   ORCHESTRATOR      │
                    │   (Mobility Brain)  │
                    └──────────┬──────────┘
         ┌──────────┼──────────┼──────────┐
         ▼          ▼          ▼          ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Dispatch │ │  Trust   │ │  Safety  │ │ Schedule │
   │  Agent   │ │  Agent   │ │  Agent   │ │  Agent   │
   └──────────┘ └──────────┘ └──────────┘ └──────────┘
         │          │          │          │
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Pricing  │ │ Support  │ │ Community│ │ Ownership│
   │ Fairness │ │  Agent   │ │  Agent   │ │  Agent   │
   └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Agent catalog

| Agent | Responsibility | Autonomy level |
|-------|----------------|----------------|
| **Orchestrator** | Routes user intent to specialists; maintains session memory | High |
| **Dispatch** | Match rider ↔ driver using trust graph, ETA, rate card, group rides | Medium — suggests, user confirms |
| **Trust** | Neighbor graph, mutual connections, verification signals | Read-only scoring |
| **Safety** | Route anomaly, speed, SOS pre-validation, silent escalation | High in emergency; otherwise advisory |
| **Schedule** | Recurring rides, church/school patterns, shared codes | Medium — auto-book with consent |
| **Pricing Fairness** | Enforce no-surge; community subsidies; promo allocation | High within policy bounds |
| **Support** | Refunds, disputes, lost items, FAQ — tool-calling to storage | Medium — resolves ≤$25 auto |
| **Community** | Event-aware demand (games, festivals, Metro delays) | Advisory |
| **Ownership** | Qualifying weeks, profit pool projections, certificate triggers | Read-only + admin alerts |
| **Voice** | STT/TTS booking for accessibility | Medium |
| **Insights** | Admin/platform recommendations | Low — propose only |
| **Compliance** | W-9 reminders, document expiry, hours-of-service | High for blocks; advisory for nudges |

### Autonomy dial (user setting)

Every rider and driver sets an **Autonomy Dial**:

| Level | Name | Behavior |
|-------|------|----------|
| 0 | **Manual** | Classic UI — maps, forms, buttons (current app) |
| 1 | **Suggest** | AI proposes; user taps to confirm (default) |
| 2 | **Routine** | Auto-book recurring trips within saved rules |
| 3 | **Delegate** | "Handle my Tuesday dialysis transport" — full chain |

Seniors default to Level 1 with voice. Power users can opt into Level 2 for commutes.

### Action audit log

Every agent action writes to an immutable **Mobility Audit Log**:

```json
{
  "agent": "dispatch",
  "action": "suggest_driver",
  "userId": "...",
  "reasoning": "3 mutual neighbors; 4.9 rating; 4 min ETA",
  "alternatives": ["driver_b", "driver_c"],
  "userDecision": "accepted",
  "timestamp": "..."
}
```

Riders tap **"Why this driver?"** on any match card → human-readable explanation. This is the trust moat.

---

## 24. Interface evolution

### 6.1 From Conversational UI → Delegative UI

Today's `AIAssistant.tsx` is **Conversational UI** — chat bubbles, streaming text. Good for support. Insufficient for mobility.

**Delegative UI** replaces chat with **intent cards**:

| User says / taps | System renders |
|------------------|----------------|
| "I need a ride home" | One card: destination inferred, 3 driver options, fare |
| "Same as last Friday" | Pre-filled booking card from memory |
| "Book for my mom" | Delegate card: pick contact, pick driver allowlist |

Chat remains available — but **60% of trips should never need it**.

### 6.2 Generative UI (GenUI)

Ride screens are **not fixed templates**. A JSON schema + renderer draws the right card:

- **Solo ride in progress** → map + ETA + SOS + driver mini-profile
- **Group ride pending joiners** → code display + slot avatars + countdown
- **Driver waiting** → earnings ticker + next predicted request + ownership progress
- **Dispute open** → timeline + evidence + agent recommendation

Implementation: `RideSurface.tsx` consumes `RideSurfaceSpec` from the Orchestrator — a typed component tree the server or edge model emits within a **whitelist of safe components** (no arbitrary HTML).

### 6.3 Zero-UI moments

- **Auto-arrive detection:** Geofence + agent confirms "James is here" → rider gets haptic + notification; no app open required
- **Smart lock screen widget:** iOS/Android PWA widgets show active ride state
- **Apple Watch / Wear OS glance:** ETA + SOS (future lane)
- **SMS fallback:** Full booking and tracking via SMS for users without smartphones

### 6.4 Visual language — "Liquid Community"

| Element | Spec |
|---------|------|
| **Primary motion** | Soft spring animations; map breathes, cards slide |
| **Color** | Blue trust base; green for active ride; warm gold for ownership moments |
| **Typography** | Inter; large numerals for fare and ETA |
| **Density** | One primary action per screen; secondary behind "More" |
| **Dark mode** | Default after 8pm (easier on drivers); respects system |
| **Accessibility** | 48px touch targets; voice-over labels; high contrast mode |

---

## 25. Trust graph and social mobility

PG Ride's unfair advantage: **people already know each other**.

### 7.1 Neighbor Graph

A privacy-preserving graph stores:

- **Explicit:** Phone search, favorites, "rode with before"
- **Implicit:** Shared group rides, church/community org membership (opt-in)
- **Verified:** Admin-approved driver status, document checks

**Trust Score** (0–100) per rider↔driver pair:

```
trust = w1·mutual_connections + w2·ride_history + w3·rating
      + w4·community_badge + w5·ownership_tier
```

Dispatch Agent weights trust **above raw ETA** when scores are comparable.

### 7.2 Degrees of separation matching

Research shows ride-matching via social proximity increases comfort and retention. PG Ride implements **"Ride within 2 degrees"** as a rider preference:

- 1st degree: rode together before
- 2nd degree: friend of a friend (mutual rider in graph)
- Open: any verified driver (default for speed)

### 7.3 Community anchors

Pre-built **mobility anchors** for PG County:

| Anchor | AI behavior |
|--------|-------------|
| **Churches** | Sunday surge-free supply nudges; recurring ride templates |
| **UMD / Bowie State** | Semester-aware student demand; move-in/move-out patterns |
| **Metro stations** | First/last mile pairing; WMATA delay ingestion |
| **FedExField / Prince George's Arena** | Event pre-positioning |
| **Senior centers** | Voice-first booking; door-to-door notes |
| **County government** | Optional public-benefit ride subsidies |

### 7.4 Referral graph 2.0

Not just "invite a friend" — **Community Chains**:

- Rider refers rider → both get PG Card credit
- Driver refers driver → ownership week credit
- Church org refers 10 families → org gets community ride pool

Tracked in `community_referrals` table; Community Agent optimizes incentives.

---

## 26. Safety intelligence

Safety is PG Ride's brand pillar. AI makes it **proactive**, not reactive.

### 8.1 Layers

| Layer | Capability |
|-------|------------|
| **L0 — Verified identity** | Admin-approved drivers; document expiry agent |
| **L1 — Ride monitoring** | Route deviation, unexpected stops, speed anomalies |
| **L2 — Behavioral patterns** | Safety Agent flags drivers with dispute/SOS clusters |
| **L3 — Environmental** | Weather, construction, crime heatmap ingestion (public data) |
| **L4 — Emergency** | SOS → 911 + emergency contact + admin + optional silent record |

### 8.2 Trust UX patterns (from robotaxi research)

- **State clarity:** Always show ride phase with plain language
- **Next-action preview:** "James will arrive in 4 min → then pickup at bus stop"
- **Reversibility:** Cancel with clear fee preview before driver travels
- **Explainability:** "Why am I seeing this driver?"

### 8.3 Guardian Mode

Riders enable **Guardian** for vulnerable family members:

- Auto-share tracking link on every ride
- Geo-fence alerts ("Mom arrived at dialysis")
- Agent calls rider if ride deviates >500m or stops >10 min unexpectedly
- Senior-friendly voice confirmations

### 8.4 Driver safety

Drivers get symmetric protection:

- Rider trust score visible before accept
- In-app audio recording opt-in (encrypted, dispute-only access)
- "End ride safely" checklist for uncomfortable situations
- Automatic admin flag on repeated rider cancellations after driver arrival

---

## 27. Economic intelligence

### 9.1 No surge — community balance instead

The **Pricing Fairness Agent** never multiplies fares. Instead it:

- Predicts undersupply → nudges drivers with **bonus pool** from community fund (not rider surcharges)
- Predicts oversupply → suggests drivers go offline to prevent idle time
- Applies group discounts (30% shared schedule — already shipped)
- Allocates promo rides ($5 off — already shipped) to highest-retention moments

### 9.2 Driver Earnings Coach

Replaces static dashboards with conversational coaching:

> "You're $47 short of your weekly goal. Staying online until 8pm near Central Ave has 73% historical match rate."

Pulls from `driver_scorecard`, `demand_heatmap`, `driver_rate_cards`.

### 9.3 Cooperative ownership AI

**Ownership Agent** tracks:

- Qualifying week progress with predictive "on track / at risk"
- Profit distribution simulations ("If Q3 profit is $X, your share is $Y")
- Governance proposals ("12 drivers qualify for Ad-Hoc — approve batch certificates?")

Share certificates become **digital, verifiable artifacts** (PDF + optional on-chain hash for provenance — future lane).

### 9.4 Dynamic rate cards — bounded

Drivers keep rate autonomy. AI suggests adjustments:

> "Your acceptance rate dropped 15% — consider lowering per-mile $0.05 to match corridor median."

Never auto-changes rates without driver consent.

---

## 28. Predictive operations

### 10.1 Demand forecasting

Train on `event_tracking`, `demand_heatmap`, `rides` (completed), external signals:

- Weather (Open-Meteo API)
- WMATA alerts
- PG County event calendar (scraped/curated)
- School calendar
- Federal holiday patterns

Output: **hourly demand grid** per county zone — feeds Dispatch and driver nudges.

### 10.2 Supply positioning

**Pre-positioning suggestions** (not commands):

> "6 drivers needed near Largo Metro between 7–9am tomorrow (Tuesday)."

Push notification to drivers with high corridor affinity.

### 10.3 Scheduled ride intelligence

Extend existing scheduled ride + group code system:

- **Auto-rebook:** "Your weekly church ride — confirm for this Sunday?"
- **Risk escalation:** Already partially shipped (T-60/30/15/5 WS alerts) — add agent-driven driver substitution
- **Cascade matching:** If primary driver drops, Trust Agent finds next-best with rider approval

### 10.4 Fleet health

Admin agent monitors:

- Document expiries (license, insurance)
- Vehicle inspection dates
- Driver fatigue (hours online — extend `driverWeeklyHours`)
- Stripe payout failures
- Webhook processing lag

---

## 29. Ambient and multimodal UX

### 11.1 Voice-first lane

- Wake phrase optional: "Hey PG" (browser Speech API + server confirmation)
- Full booking, cancellation, status via voice
- Read-aloud fare and driver name for accessibility
- Integration with car Bluetooth for drivers (hands-free accept/decline)

### 11.2 Multimodal context

Future **Vision Agent** (camera opt-in):

- Rider at curb: flash phone → driver sees "rider photo at pickup" (privacy-controlled, 60s TTL)
- Driver document re-verification via guided camera capture

### 11.3 Mood-adaptive rides (premium lane)

Inspired by MOVA/HIVE research — **optional Calm Ride mode**:

- Rider selects: Focus / Calm / Social / Family
- Adjusts in-app music suggestion, minimizes notifications, enables quiet driver cue
- No biometric sensors in v1 — preference-based only

### 11.4 In-ride experience

Replace missing chat (backlog) with **Canned Context Cards**:

| Rider taps | Driver sees |
|------------|-------------|
| "I'm coming out" | Instant push |
| "I'm here" | Instant push |
| "Running 2 min late" | Instant push |
| "Wrong entrance — meet at side door" | + map pin adjustment |

Zero typing. Zero surveillance. Maximum clarity.

---

## 30. Future technical architecture

### 12.1 Evolution from current stack

| Layer | Today | Target |
|-------|-------|--------|
| **AI** | Single Claude route in `routes.ts` | Agent runtime + tool registry |
| **Realtime** | WebSocket `/ws` | WS + fix payload shapes + SSE for agent streams |
| **Storage** | Stubbed GCS | S3/GCS + encrypted doc vault |
| **Search** | SQL queries | pgvector for FAQ/RAG + graph queries for trust |
| **Events** | `event_tracking` table | Kafka/Redis streams (or Neon logical replication) |
| **Jobs** | setInterval in routes | Dedicated worker service on Railway |

### 12.2 Agent runtime (new service)

```
server/
├── agents/
│   ├── orchestrator.ts      # Intent routing
│   ├── dispatch.ts          # Match scoring
│   ├── trust.ts               # Graph queries
│   ├── safety.ts              # Anomaly detection
│   ├── support.ts             # Tool-calling support
│   ├── registry.ts            # Agent permissions
│   └── tools/                   # Typed DB/API tools
│       ├── rides.ts
│       ├── users.ts
│       ├── payments.ts
│       └── notifications.ts
├── genui/
│   ├── schema.ts              # RideSurfaceSpec types
│   └── renderer.tsx           # Whitelisted component map
└── workers/
    ├── demand-forecast.ts
    ├── document-expiry.ts
    └── ownership-recalc.ts
```

### 12.3 Model strategy

| Use case | Model tier | Rationale |
|----------|------------|-----------|
| Orchestrator / Support | Claude Sonnet | Fast, tool-calling |
| Complex disputes | Claude Opus | Reasoning |
| FAQ generation | Sonnet batch | Cost |
| Demand forecast | Classical ML + LLM summary | Deterministic core |
| Safety anomaly | Rules + lightweight classifier | Latency <100ms |
| Voice STT/TTS | Whisper + browser TTS / ElevenLabs | Accessibility |

**RAG pipeline:** Embed `faq_entries`, `platform_insights`, ride policies, MASTER_PLAN excerpts → pgvector → inject into agent context. Close the loop with `ai_feedback` thumbs.

### 12.4 Fix existing technical debt (prerequisite)

| Issue | Fix |
|-------|-----|
| WS `driver_location` shape mismatch | Align server + `RiderDashboard` handler |
| `platform_insights` never written | Insights Agent calls `createPlatformInsight` |
| FAQ generation ignores conversations | Pass anonymized chat excerpts to prompt |
| Object storage stub | Wire S3/GCS (MASTER_PLAN P0) |
| Notification bell inert | Wire to push + in-app inbox |

---

## 31. Data and AI infrastructure

### 13.1 New tables (conceptual)

| Table | Purpose |
|-------|---------|
| `agent_audit_log` | Immutable agent action record |
| `user_autonomy_settings` | Autonomy dial per user |
| `trust_edges` | Rider↔driver trust graph |
| `mobility_intents` | Parsed delegative intents |
| `ride_surface_cache` | GenUI spec per active ride |
| `demand_forecasts` | Hourly zone predictions |
| `community_anchors` | Churches, schools, venues |
| `guardian_links` | Family tracking relationships |
| `agent_tool_permissions` | RBAC for agent capabilities |

### 13.2 Privacy principles

- **Graph opt-in:** Community connections require explicit consent
- **Agent logs:** Retained 90 days; PII redacted in training exports
- **No driver surveillance:** Location only during online/active ride
- **Explainability > accuracy:** Users can always see why a match was made
- **Human override:** Admin can veto any agent decision; audit trail preserved

### 13.3 Embedding and memory

- **Short-term:** Conversation window per session (existing `conversations`)
- **Long-term:** User mobility profile (home/work/church addresses, preferred drivers, autonomy level)
- **Collective:** Anonymized heatmaps and FAQ — never sell rider data

---

## 32. AI implementation roadmap

### Phase A — Foundation (Months 1–3)

**Theme:** Fix the plane while flying.

| # | Deliverable | Builds on |
|---|-------------|-----------|
| A1 | S3/GCS object storage live | `objectStorage.ts` stub |
| A2 | WebSocket payload alignment | `useWebSocket.ts`, `routes.ts` |
| A3 | Agent audit log + "Why this driver?" | `rideWorkflowService.ts` |
| A4 | RAG for AI assistant (pgvector) | `AIAssistant.tsx`, `faq_entries` |
| A5 | Canned message cards (rider↔driver) | Backlog chat item |
| A6 | Insights Agent → `platform_insights` | Admin Analytics panel |
| A7 | In-app notification inbox | Bell buttons on dashboards |

### Phase B — Delegative UI (Months 4–6)

**Theme:** One card to ride.

| # | Deliverable |
|---|-------------|
| B1 | `RideSurface` GenUI renderer + schema |
| B2 | Orchestrator agent with intent parsing |
| B3 | Home screen intent card (replaces idle map-first) |
| B4 | "Same as last time" + recurring ride templates |
| B5 | Autonomy Dial user setting |
| B6 | Voice booking lane (accessibility) |
| B7 | Guardian Mode v1 (tracking links + geo alerts) |

### Phase C — Trust Graph (Months 7–9)

**Theme:** Neighbors, not strangers.

| # | Deliverable |
|---|-------------|
| C1 | `trust_edges` graph + Trust Score |
| C2 | Dispatch Agent with trust-weighted matching |
| C3 | Favorite drivers + "degrees of separation" filter |
| C4 | Community referral chains |
| C5 | Community anchors (churches, Metro, campuses) |
| C6 | Explainable match cards everywhere |

### Phase D — Predictive Co-op (Months 10–14)

**Theme:** The platform anticipates.

| # | Deliverable |
|---|-------------|
| D1 | Demand forecast worker + heatmap v2 |
| D2 | Driver Earnings Coach |
| D3 | Supply positioning push nudges |
| D4 | Pricing Fairness Agent (community bonus pool) |
| D5 | Ownership Agent projections |
| D6 | Scheduled ride auto-rebook |
| D7 | Safety anomaly layer (route deviation) |

### Phase E — Autonomous Operations (Months 15–24)

**Theme:** 80% agent-resolved.

| # | Deliverable |
|---|-------------|
| E1 | Support Agent with auto-resolve ≤$25 |
| E2 | Compliance Agent (W-9, doc expiry) — Path A/B from §15 |
| E3 | Admin approve-and-apply workflow for all agents |
| E4 | SMS booking + tracking fallback |
| E5 | PWA lock screen widgets |
| E6 | Calm Ride mode |
| E7 | Multi-language (English, Spanish, French — PG County demographics) |

### Phase F — Research lane (ongoing)

| Item | Notes |
|------|-------|
| L4 readiness data collection | Waypoint quality, disengagement logging — no robotaxi promise |
| Blockchain share certificates | Optional provenance hash — not DAO tokenomics |
| Transit integration | WMATA API, MARC, regional bus |
| EV fleet incentives | Green bonus pool from community fund |

---

## 33. AI success metrics

### AI-native KPIs

| Metric | Target (24 mo) |
|--------|----------------|
| **Intent completion rate** | 70% of rides booked without form navigation |
| **Agent resolution rate** | 80% support queries resolved without human |
| **Match explainability views** | <5% "Why?" taps (means defaults are trusted) |
| **Trust-weighted match acceptance** | +20% vs proximity-only baseline |
| **Voice booking share** | 15% of senior-segment trips |
| **Guardian Mode adoption** | 25% of family accounts |
| **Driver coach engagement** | 40% weekly active drivers view forecast |
| **Zero surge compliance** | 100% — never a multiplier >1.0 on base fare |
| **Safety anomaly false positive** | <2% |
| **Ownership pipeline accuracy** | Predict qualifying week ±1 week |

### Business KPIs (see §16)

Rides/week, retention, driver qualifying weeks, NPS, referral conversion.

### Soul metrics

See [Appendix C](#appendix-c--soul-metrics-qualitative) for the qualitative companion set — the things we measure to know whether the *feeling* of the product matches the *function*.

---

## 34. Explicit non-goals

PG Ride will **not**:

- Become a national platform (PG County forever)
- Introduce surge pricing (community balance instead)
- Replace human drivers with robotaxi in the product roadmap
- Sell rider location data to advertisers
- Use dark patterns to manipulate driver hours
- Deploy unaudited agent actions on payments >$25 without confirmation
- Build a generic chatbot as the primary interface
- Add crypto tokens or speculative DAO governance

If a feature request maps to any of the above, the default answer is **no** — even if it would lift a short-term metric. Soul before scale.

---

## 35. Competitive positioning

```
                    HIGH TECH / AI-NATIVE
                            │
              Uber/Lyft AV  │  ★ PG RIDE VISION
              (robotaxi)    │  (community agents)
                            │
    ANONYMOUS ──────────────┼────────────── TRUSTED
                            │
              Uber/Lyft     │  Driver.coop
              (today)       │  OpenRide
                            │
                    LOW TECH / TRADITIONAL
```

**PG Ride occupies a unique quadrant:** maximum trust density + maximum AI sophistication, without abandoning human drivers or community ownership.

### Why we win

| Competitor | Their AI | PG Ride AI |
|------------|----------|------------|
| Uber | Fleet-scale dispatch, robotaxi | N/A for community |
| Lyft | Mapping + AV partnerships | N/A for community |
| Driver.coop | Basic app | No agent layer |
| OpenRide | Compliance-first dispatch | No trust graph |
| **PG Ride** | — | **Trust graph + co-op agents + calm GenUI** |

---

## Appendix A — Immediate next sprint (from current codebase)

The highest-leverage work **starting now**:

1. **Production deploy** — Railway vars per [`TRACK_B_CREDENTIALS.md`](TRACK_B_CREDENTIALS.md) (`DATABASE_URL`, `SESSION_SECRET`, then Stripe/GCS/VAPID as needed)
2. **Object storage live** — `GCS_BUCKET_NAME` + credentials (driver doc uploads still 503 without)
3. **Tax compliance path** — AH-060 decision (Path A/B/C) before 1099 season
4. **Ride receipts polish** — ✅ detailed receipts in ride history ([#59](https://github.com/CNBSSA/nbhoodride/pull/59))
5. **Free-text in-app chat** — ✅ rider↔driver chat during active rides (quick messages + text)

Phases A–F and backlog items through [#57](https://github.com/CNBSSA/nbhoodride/pull/57) are merged on `main`.

---

## Appendix B — Reference research

| Source | Insight applied |
|--------|-----------------|
| Uber/Lyft/NVIDIA agentic AI (2026) | Multi-agent dispatch orchestration |
| Robotaxi UX framework (arXiv 2026) | Trust, explainability, state clarity |
| MOVA / HIVE ambient mobility | Calm Ride mode (optional) |
| Pilo autonomous taxi UX (Behance) | Clean single-card booking |
| Degrees-of-separation ride matching (SJSU) | Trust graph dispatch |
| Driver.coop / OpenRide | Cooperative infrastructure patterns |
| UX Tigers 2026 predictions | Delegative UI, GenUI, agent audit |

---

## Appendix C — Soul metrics (qualitative)

Quantitative KPIs in §16 and §33 measure whether the **machinery** works. These measure whether the **feeling** does. Reviewed each quarter alongside the dashboards.

| Soul metric | How we observe it |
|---|---|
| **Did a senior book a ride by voice without help?** | Voice-booking events tagged with `accessibility_session=true`; observed in user interviews |
| **Did a driver describe themselves as an *owner* (not just a contractor) unprompted?** | Driver interview pull quotes; mentions on `community_referrals` social posts |
| **Did a rider thank the app for explaining a match?** | "Why this driver?" thumbs-up rate; in-app feedback excerpts |
| **Did a family member say they *worry less* about a senior rider?** | Guardian Mode opt-in rate; NPS comments from secondary accounts |
| **Did the app stay quiet when it should have?** | Notifications/session ratio vs sector benchmarks; quiet-hours violation rate (target: 0) |
| **Did a competitor describe us correctly?** | Press coverage tone (community-owned vs another rideshare); analyst framing |
| **Did a driver post their share certificate online?** | Social mentions of `#PGRideOwner`; ownership-moment screenshots in `attached_assets/` over time |
| **Did the AI ever feel like it was watching, not helping?** | Privacy-related support tickets per 10k MAU (target: trending down) |

When these trend right, the quantitative metrics tend to follow. When they don't, no dashboard will save us.

---

*This vision extends Part I of this document. Update both when strategy shifts. The calm surface is the product. The agent brain is the moat. The community soul is the reason.*

---

*Single source of truth for PG Ride. Part I = operational truth today. Part II = strategic blueprint. Autonomous execution scope: [`EXECUTION_TRACKS.md`](EXECUTION_TRACKS.md). Update this file when roadmap, architecture, or GTM strategy changes. The calm surface is the product. The agent brain is the moat. The community soul is the reason.*
