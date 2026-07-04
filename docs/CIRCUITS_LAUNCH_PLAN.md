# PG Ride Circuits — Launch Strategy & Feature Plan

**Tagline:** *Guaranteed seats, no surge.*

**One-line pitch:** PG Ride launches not as an on-demand Uber alternative, but as **Circuits** — a published weekly timetable of shared community rides (fixed route, fixed time, bookable seats) that a small driver pool can serve perfectly.

---

## 1. Why Circuits (the strategy)

On-demand ridesharing needs *density* — enough drivers that a random request is
picked up in minutes. At launch we have neither the drivers nor the marketing
budget to buy that density, and one failed on-demand request ("nobody accepted")
loses a rider forever.

Circuits flips the constraint into the product:

| Constraint | Circuits answer |
|---|---|
| Few drivers | One driver serves 3–4 paying seats per run; zero idle hours — every driven hour is pre-booked |
| No marketing budget | Anchor organizations (churches, warehouses, senior centers) aggregate riders for free |
| Can't promise "5 minutes away" | Promise something Uber doesn't: a **guaranteed** seat at a **published** time, no surge |
| Riders fear flaky new apps | A timetable reads as *curated transit*, not a failing marketplace |

**What we sell is certainty, not immediacy.** The riders who value that most —
shift workers, seniors, churchgoers, non-drivers with standing appointments —
are exactly the riders on-demand apps serve worst.

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Circuit** | A named, recurring shared run: route + day/time + seat count + fare. e.g. *Sunday Church Circuit, 9:00am, Largo Town Center → First Baptist, 3 seats, $6/seat* |
| **Run** | One dated instance of a circuit (this Sunday's 9am run) |
| **Timetable** | The published list of this week's runs, visible to every rider |
| **Seat** | One bookable slot on a run |
| **Anchor** | An organization or facility that concentrates riders on a circuit (church, warehouse, senior center, Metro station, grocery store) |
| **Claim board** | Driver-facing list of upcoming runs/scheduled rides available to claim |
| **Cutoff** | The time booking closes for a run (e.g. 8pm the night before) so the driver's plan is fixed |

---

## 3. Phased launch plan

### Phase 1 — Circuits-only launch
- Pick **2–4 circuits** across non-overlapping time blocks so one small driver
  pool can stack all of them:
  - **Warehouse shift circuits** (weekday ~4:30–6:00am and late-evening return)
    — Amazon/Target warehouse workers; transit fails exactly at these hours;
    same trip every day; demand naturally pooled at one building.
  - **Metro feeder circuit** (weekday rush hours) — neighborhoods with poor
    station access.
  - **Grocery loop** (Saturday morning).
  - **Church circuits** (Sunday morning).
- Publish the weekly timetable; take seat bookings with an evening cutoff.
- Recruit through **3–5 anchor orgs**, not individual ads.
- Public framing: *community ride circuits — guaranteed seats, no surge.*
  Never "like Uber but local"; scarcity must read as curated, not failing.

### Phase 2 — Subscriptions & prepaid packs
- Turn repeat bookings into weekly subscriptions / prepaid ride packs
  (cash up front, riders locked in). `recurring_ride_schedules` (weekly
  rebook prompts) and the virtual wallet ledger already exist to power this.
- With reliability data (e.g. "96% of 400 shift rides on time"), pitch
  employer-paid warehouse circuits (B2B contract revenue).

### Phase 3 — On-demand inside proven windows
- Only when circuits run consistently full, open on-demand **within the
  time/geography windows the circuit data has proven** — density is known
  before a single spinner is shown.

**Driver flywheel:** equity is the recruiting budget. The driver-ownership
feature already in the app makes the pitch Uber can't copy: *"drive 6
scheduled hours a week, own a piece of the co-op."* Best early riders become
the next driver-owners.

---

## 4. What the app supports TODAY (manual Circuits, zero new code)

The Mode-4 **shared schedule** flow is live end-to-end:

- Organizer creates a shared-schedule ride (pickup, destination, `scheduledAt`)
  → server generates a **join code** (`POST /api/rides/create-shared-schedule`).
- Riders enter the code (`JoinScheduleModal`) → preview
  (`GET /api/rides/schedule/:code`) → book into the group at a discount
  (`POST /api/rides/join-schedule`).

**Manual launch runbook (weekly, ~20 min for 2–3 circuits):**
1. Create each run in the app as a shared schedule; copy the generated code.
2. Publish codes on the flyer / church bulletin / WhatsApp / break-room sheet:
   *"SUNDAY CHURCH CIRCUIT — 9am from Largo Town Center. Open PG Ride → Join
   Schedule → code `XK4TQ2BF`. 3 seats."*
3. Confirm the driver for each run directly.
4. Recreate next week's runs each Sunday evening.

**Known limitations of the manual flow** (accepted for validation weeks):
- Join codes are random 8-char strings, not memorable names.
- `maxSlots` defaults to **3 seats** per group.
- Riders must already have an **approved, email-verified account** — sign
  people up days before a run, not at the curb.
- No in-app discovery: the timetable exists only on paper/WhatsApp.
- No automatic driver assignment; no automatic weekly recurrence.

---

## 5. Phase 1 build list (turns manual Circuits into the product)

| # | Feature | What it does | Builds on |
|---|---------|--------------|-----------|
| 1 | **Circuit definitions (admin)** | Admin creates named recurring circuits: label, route, day-of-week, time, seat count, fare | `ride_groups` machinery; new `circuits` table |
| 2 | **Timetable screen (rider)** | "This week's rides" in-app: browse runs, see seats left, book with one tap — no codes | `join-schedule` endpoint under the hood |
| 3 | **Weekly run regeneration** | Each circuit auto-creates next week's run at a fixed lead time | Existing scheduled-ride plumbing |
| 4 | **Booking cutoff** | Runs close at cutoff (e.g. 8pm night before); after cutoff the manifest is fixed | — |
| 5 | **Driver claim board** | Drivers see upcoming runs and claim them; claimed run = committed driver | Driver dashboard |
| 6 | **Reminders** | Push + email: booking confirmation at cutoff, night-before reminder, morning-of "driver on the way" | Push (VAPID) + Resend, both live |
| 7 | **Public timetable page** | Shareable web page of this week's circuits, viewable without login — doubles as the marketing site | — |

Suggested build order: 1 → 2 → 3 → 6 → 5 → 4 → 7 (timetable + booking first;
claim board can be manual coordination until driver count grows).

---

## 6. Operating principles

- **Reliability is existential.** A missed church run is an apology; a missed
  4:30am warehouse run is someone's job. No circuit goes on the timetable
  without a committed driver + a named backup (founder drives if needed) for
  its first month.
- **Fill rate over coverage.** Better 2 circuits at 90% seats sold than 6 at
  30%. Add circuits only when existing ones are consistently full.
- **Anchor first, then timetable.** A circuit is created because an anchor
  asked for it / confirmed riders exist — never speculatively.
- **Legal check before employer contracts.** Serving individual riders fits
  the TNC model; formal employer-paid contract circuits may drift toward
  contract carriage under Maryland PSC rules — one conversation with a
  transportation attorney before signing anything with a company (not needed
  for flyering workers).

## 7. Metrics that matter

| Metric | Target signal |
|---|---|
| Seat fill rate per run | ≥ 75% sustained → circuit is working; add capacity |
| Rides per driver-hour | ≥ 3 (vs ~1 for on-demand at low density) |
| Repeat riders week-over-week | The subscription signal for Phase 2 |
| On-time run completion | ≥ 95% — the number that wins employer contracts |
| Riders per anchor | Which anchors to deepen vs drop |

---

*Living document — update as circuits launch and the Phase 1 build lands.
Strategy agreed 2026-07-04.*
