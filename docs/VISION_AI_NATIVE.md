# PG Ride — AI-Native Future Vision

**The blueprint for the most sophisticated community-owned mobility platform on earth.**

| Field | Value |
|-------|-------|
| **Document** | AI-Native Product Vision |
| **Version** | 1.0 |
| **Date** | June 2026 |
| **Builds on** | [`MASTER_PLAN.md`](MASTER_PLAN.md) (current shipped state) |
| **Horizon** | 18–36 months |

---

## Table of contents

1. [North star](#1-north-star)
2. [Design philosophy](#2-design-philosophy)
3. [What AI-native means for PG Ride](#3-what-ai-native-means-for-pg-ride)
4. [The experience in 2030](#4-the-experience-in-2030)
5. [Multi-agent architecture](#5-multi-agent architecture)
6. [Interface evolution](#6-interface-evolution)
7. [Trust graph and social mobility](#7-trust-graph-and-social-mobility)
8. [Safety intelligence](#8-safety-intelligence)
9. [Economic intelligence](#9-economic-intelligence)
10. [Predictive operations](#10-predictive-operations)
11. [Ambient and multimodal UX](#11-ambient-and-multimodal-ux)
12. [Technical architecture](#12-technical-architecture)
13. [Data and AI infrastructure](#13-data-and-ai-infrastructure)
14. [Implementation roadmap](#14-implementation-roadmap)
15. [Success metrics](#15-success-metrics)
16. [Explicit non-goals](#16-explicit-non-goals)
17. [Competitive positioning](#17-competitive-positioning)

---

## 1. North star

> **PG Ride becomes the operating system for community movement in Prince George's County — where AI handles complexity so neighbors can simply move.**

We are not building another Uber with a chatbot bolted on. We are building the first **cooperative, hyper-local, AI-orchestrated mobility network** where:

- Riders **delegate intent** ("get Mom to her dialysis appointment Thursday at 7:15") instead of tapping through forms
- Drivers **delegate operations** ("maximize earnings between 4–9pm in Largo without burning out")
- The platform **delegates fairness** (no surge, but intelligent supply rebalancing and community subsidies)
- Ownership **delegates governance** (profit pools, qualifying weeks, and safety policy informed by transparent AI recommendations — never hidden algorithms)

**The feeling:** Calm, warm, inevitable. Like asking a trusted neighbor who happens to know every road, every driver, and every safe shortcut in PG County.

**The constraint:** Human drivers remain central for the foreseeable future. Autonomy is a research lane, not the product thesis. PG Ride wins on **trust density**, not sensor stacks.

---

## 2. Design philosophy

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

## 3. What AI-native means for PG Ride

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

## 4. The experience in 2030

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

---

## 5. Multi-agent architecture

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

## 6. Interface evolution

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

## 7. Trust graph and social mobility

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
| **FedExField / Prince George's Arena | Event pre-positioning |
| **Senior centers** | Voice-first booking; door-to-door notes |
| **County government** | Optional public-benefit ride subsidies |

### 7.4 Referral graph 2.0

Not just "invite a friend" — **Community Chains**:

- Rider refers rider → both get PG Card credit
- Driver refers driver → ownership week credit
- Church org refers 10 families → org gets community ride pool

Tracked in `community_referrals` table; Community Agent optimizes incentives.

---

## 8. Safety intelligence

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

## 9. Economic intelligence

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

## 10. Predictive operations

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

## 11. Ambient and multimodal UX

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

## 12. Technical architecture

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

## 13. Data and AI infrastructure

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

## 14. Implementation roadmap

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
| E2 | Compliance Agent (W-9, doc expiry) — Path A/B from MASTER_PLAN §15 |
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

## 15. Success metrics

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

### Business KPIs (unchanged from MASTER_PLAN)

Rides/week, retention, driver qualifying weeks, NPS, referral conversion.

---

## 16. Explicit non-goals

PG Ride will **not**:

- Become a national platform (PG County forever)
- Introduce surge pricing (community balance instead)
- Replace human drivers with robotaxi in the product roadmap
- Sell rider location data to advertisers
- Use dark patterns to manipulate driver hours
- Deploy unaudited agent actions on payments >$25 without confirmation
- Build a generic chatbot as the primary interface
- Add crypto tokens or speculative DAO governance

---

## 17. Competitive positioning

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

The highest-leverage work **starting tomorrow**:

1. **Merge PR #37** (MASTER_PLAN consolidation)
2. **Wire object storage** — unlocks driver verification pipeline
3. **Fix WS `driver_location` mismatch** — unlocks live rider map
4. **Add `agent_audit_log` migration** — foundation for explainable dispatch
5. **RAG pipeline for AIAssistant** — first true "AI-native" upgrade
6. **Canned message cards** — ships in-ride communication without full chat

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

*This vision extends [`MASTER_PLAN.md`](MASTER_PLAN.md). Update both when strategy shifts. The calm surface is the product. The agent brain is the moat. The community soul is the reason.*
