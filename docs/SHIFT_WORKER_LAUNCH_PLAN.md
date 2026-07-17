# Shift-worker launch plan (PG Ride)

**Document ID:** `SHIFT_WORKER_LAUNCH_PLAN`  
**Priority:** P0 product focus — launch wedge for warehouse / logistics shift workers (Amazon, Target, FedEx, similar).

## The job to be done

When a shift ends, a worker wants to:

1. **Schedule** a ride leaving the job site (not “right now” only).
2. **Invite colleagues** (friends/coworkers) onto the **same run** — up to **3 people** total (organizer + 2).
3. Each person has their **own pickup** (warehouse) and **own destination** (home).
4. Everyone sees **one departure time**, **shared discount** (30% when ≥2 riders), and **one driver** when claimed.

This is **Mode 4 — Shared Schedule** (`rideType: shared_schedule`, `PG-XXXXXX` codes), not solo schedule and not auto-matched “share ride” with strangers.

## What already ships

| Piece | Status |
|-------|--------|
| Create group + code (`POST /api/rides/create-shared-schedule`) | Shipped |
| Join with code (`POST /api/rides/join-schedule`) | Shipped |
| 3 seats, 30% discount when 2nd joins | Shipped |
| Driver scheduled claim board | Shipped (needs `scheduledAt`) |
| Circuits (fixed route, admin-defined) | Shipped — good for **recurring** warehouse runs |
| UX buried under “More ways to ride” | Gap |

## Launch wedge (recommended)

**Phase 1 — Coworker group schedule (this PR track)**  
Ad-hoc groups: one worker books “shift end” time, shares code in WhatsApp/SMS/group chat.

**Phase 2 — Anchor circuits**  
Admin creates e.g. “Amazon BWI1 — Fri 11:30 PM” with fixed pickup; colleagues book seats without codes (see `docs/CIRCUITS_LAUNCH_PLAN.md`).

**Phase 3 — Anchor presets in app**  
“Leaving Amazon / Target / FedEx” shortcuts (geofence or saved place) on the home screen.

## P0 fixes (implementation)

1. **Departure time required** on shared schedule (shift end).
2. **Joiners inherit** group `scheduledAt` → show in upcoming rides + driver board.
3. **Driver claims whole group** — all seats get same driver; group locks (no more joiners).
4. **One row per group** on driver open scheduled list.
5. **Home CTA** — “Ride home with coworkers” opens group schedule (not buried).

## P1 next

- `navigator.share` + deep link for codes  
- Organizer dashboard: slots filled, resend code  
- Rider chip for `groupId` (not only auto-matched shared rides)  
- SMS invite template for shift group chats  
- Public timetable page for circuits (item 7 in circuits plan)

## Success metrics (first 30 days)

- ≥1 completed **shared_schedule** ride per week with `filledSlots ≥ 2`
- Median time from code share → 2nd joiner &lt; 15 minutes (shift change window)
- Driver claim before `scheduledAt` for ≥80% of group schedules

## Changelog

| Date | Notes |
|------|--------|
| 2026-07-17 | Initial plan + P0 backend/UI for shift-worker group schedule |
