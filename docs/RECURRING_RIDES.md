# Recurring rides — Schedule, Coworkers, Shuttles

Weekly **remind + one-tap rebook** for three rider modes (D6 + circuits).

| Mode | UI | `ride_kind` | Rebook creates |
|------|-----|-------------|----------------|
| **Schedule ride** | Schedule modal → “Repeat every week” | `solo_schedule` | New solo scheduled ride |
| **Coworkers** | Shared schedule → “Repeat every week” | `coworker_group` | New `PG-XXXXXX` group |
| **Shuttles** | Shuttles sheet → ⟳ on a route | `circuit` | Books seat on current week's run |

## Flow

1. Rider opts in → `POST /api/rider/recurring-schedules`
2. Cron/agent `processRecurringRideRebooks` (same day, ±2h window, ≥7 days since last prompt) → in-app + push notification
3. Rider taps notification or opens `/rider?rebookScheduleId=…` → **Book this week**
4. `POST /api/rider/recurring-schedules/:id/rebook` runs the correct workflow

Pause: `POST /api/rider/recurring-schedules/:id/deactivate`

## Ops

- Admin must publish **active circuits** for shuttle subscriptions to rebook.
- Coworker recurring creates a **new code each week** — organizer shares again.
- Migration adds `ride_kind`, `preferred_minute`, `circuit_id`, `options` on `recurring_ride_schedules`.

See also: [SHIFT_WORKER_LAUNCH_PLAN.md](./SHIFT_WORKER_LAUNCH_PLAN.md), [CIRCUITS_LAUNCH_PLAN.md](./CIRCUITS_LAUNCH_PLAN.md).
