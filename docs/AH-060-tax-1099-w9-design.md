# AH-060 — IRS 1099-NEC + W-9 collection for drivers

**Status:** Code-side shipped (Path A, Stripe Connect). Operational gaps remain — see "Outstanding" below.
**Last checked:** 2026-06-06
**Risk if unaddressed:** Direct IRS non-compliance for any tax year a driver earns over $600. Penalties currently $310 per missed/late form, with intentional-disregard escalation. Plus drivers won't receive the 1099-NEC they need to file their own returns.

---

## Implementation status (2026-06-06)

Path A from the options below was selected and shipped in three sub-phases on `claude/audit-high-severity-fixes`:

| Commit | Sub-phase | What landed |
|---|---|---|
| `a42e616` | A | Schema columns on `users` (`stripeConnectAccountId`, `…OnboardingCompletedAt`, `…PayoutsEnabled`, `…ChargesEnabled`) + `server/stripeConnectService.ts` thin wrapper over Stripe's Express / Account Link / Transfer APIs |
| `d95215a` | B | Onboarding endpoints (`POST /api/driver/connect/onboard`, `GET /api/driver/connect/status`) + `/driver/connect/return` UI page + driver-dashboard onboarding card |
| `63bba09` | C | Payout flow swapped to `stripe.transfers.create` for Connect-enrolled drivers; `transfer.*` webhook handlers; idempotency keyed on `payout_requests.id` |
| `09fcda6` + `8bc2e82` | Hardening | Webhook claim-release-on-error, `processedWebhookEvents` `uniqueIndex`, `transfer.created` recovery via `metadata.payoutRequestId`, `processedBy` not = driver id, Stripe account name guard `&&` not `||`, `StripeConnectReturn` poll-loop fix, status endpoint short-circuit |

### What drivers who complete Stripe Connect onboarding now get
- W-9 collection through Stripe's hosted form (we never see SSN/TIN)
- Payouts via `stripe.transfers.create` with end-to-end idempotency + orphan recovery
- 1099-NEC generation and IRS e-filing by Stripe in January (CF/SF covers Maryland state filing through 2026)
- Bank deposit in 1–2 business days

### What drivers WITHOUT Stripe Connect still get
- The legacy manual payout flow (Zelle / CashApp / PayPal / check)
- **NO W-9 collection. NO 1099-NEC. Full original audit finding still applies to them.**

This is the outstanding gap tracked separately as `docs/AH-073-manual-payout-1099-gap.md`.

---

## Outstanding gaps blocking go-live

These are NOT code work — they're operational, business, or external. None of them can be closed by merging a PR.

### 1. Stripe Dashboard configuration (BLOCKER)
- Enable Connect platform under Dashboard → Settings → Connect
- Opt into 1099-NEC e-delivery + e-filing under Dashboard → Connect → Tax forms
- Subscribe the existing webhook endpoint to `account.updated`, `transfer.created`, `transfer.failed`, `transfer.reversed`
- Confirm platform balance funding strategy (in test mode this requires test charges; in production it comes from rider payments minus refunds)

Without these the code works but no 1099s actually get issued. **Pre-launch blocker.**

### 2. Manual-payout drivers have no 1099/W-9 plan (BLOCKER)
See `docs/AH-073-manual-payout-1099-gap.md`. Three options:
- Make Connect onboarding mandatory before any payout (UX-aggressive)
- Implement Path B (Tax1099-style fallback) for manual-payout drivers
- Sunset the manual payout flow with a deadline notice to existing drivers

### 3. Profit distributions: 1099 vs K-1 determination (OPEN QUESTION)
The `profit_distributions` table pays drivers their ownership share. Are these:
- **1099-NEC** (independent-contractor compensation, file with the IRS by Jan 31), or
- **K-1** (partnership / S-corp distribution, file with the partnership return)?

This affects whether Stripe's 1099 program covers them or whether a separate filing flow is needed. Needs CPA / tax-attorney sign-off — listed in the design doc since first draft, not resolved.

### 4. Year-to-date earnings tracking dashboard
No admin view shows "drivers approaching or past $600 YTD" broken out by payment channel (Stripe Connect vs manual). Without it you can't tell in October whether any manual-payout drivers are at risk for January's audit window.

Suggested: new admin page `/admin/tax/year-to-date` that sums `wallet_transactions` per driver per tax year, splits by payment-channel category, and highlights anyone over $600 in the manual-payout bucket.

### 5. CPA / tax attorney sign-off (BLOCKER)
The original design doc explicitly noted: *"This is not legal or tax advice. Before shipping any 1099 flow, engage a CPA or tax attorney who is familiar with marketplace / 1099 platforms."*

Not yet engaged. Penalties for misfiled 1099s scale with intentional disregard; getting this wrong is materially worse than not doing it at all. **Pre-launch blocker.**

---

## Original design (for reference)

The three-path comparison that led to picking Path A. Kept verbatim below for the design history.

### Path A — Stripe Connect (chosen + implemented)

If drivers are paid via Stripe Connect (transfers to connected accounts), Stripe handles 1099-NEC generation and IRS filing **automatically** through their [Connect 1099 program](https://stripe.com/docs/connect/tax-reporting). Drivers complete a Stripe-hosted W-9 during onboarding; Stripe e-files the 1099 and emails the driver a digital copy in January.

**Pros:**
- Lowest implementation cost — Stripe owns the tax flow.
- TIN collection + validation handled by Stripe (no custom UI).
- Backup withholding handled automatically.
- Compliance updates ride along with Stripe's platform updates.

**Cons:**
- Requires migrating driver payouts from the current manual flow (Zelle / CashApp / PayPal / check) to Stripe Connect transfers.
- Driver onboarding adds a Stripe identity-verification step (KYC).
- Stripe Connect fees (~$2/month per active connected account + transfer fees).

### Path B — Tax1099 (or comparable third-party filing service)

Keep payouts as-is. Collect W-9 data in our own UI, validate TINs, and at year-end push to a dedicated 1099 filing API like [Tax1099.com](https://www.tax1099.com), Track1099, or Avalara.

**Pros:**
- No payout migration. Drivers keep their existing payout methods.
- Lower per-form cost than fully manual filing.
- Full control over the W-9 collection UX.

**Cons:**
- We own the W-9 collection, TIN validation, year-end aggregation, and backup withholding logic — non-trivial.
- TIN validation against the IRS service requires e-Services enrollment.
- ~2–3 weeks of focused work.

**Scope (if revisited as fallback for manual-payout drivers):**
- New tables: `driver_tax_info` (W-9 fields + verification status), `driver_annual_earnings` (gross per calendar year, recalculated nightly).
- New driver UI: W-9 collection form, with TIN encryption at rest.
- New admin UI: review W-9 status per driver, see annual earnings.
- Nightly cron: aggregate prior day's earnings into `driver_annual_earnings`.
- Year-end script (early January): post W-2-eligible drivers to Tax1099 API, store filing receipts.
- Backup withholding hook in the payout path.

### Path C — Manual filing (rejected, kept for context)

Collect W-9s manually (PDF upload), store them encrypted, and have an admin do the 1099-NEC filing through the IRS [IRIS portal](https://www.irs.gov/iris) at year-end. Lowest engineering cost; doesn't scale beyond ~50 drivers.

---

## Compliance reminders the IRS imposes (any path)

For each contractor (driver) paid **$600 or more in a calendar year**, PG Ride as the payer must:

1. **Collect a W-9** before any payment, containing legal name, federal tax classification, address, TIN, and signature.
2. **Validate the TIN** — at minimum format-check; ideally match against IRS TIN matching service.
3. **Track gross payments per driver per calendar year** — including ride payouts, tips, bonuses, profit distributions if 1099-able.
4. **Generate 1099-NEC** by **Jan 31 of the following year** to both the driver and the IRS, for every driver who crossed $600.
5. **File with the IRS** electronically (FIRE / IRIS) or by paper.
6. **State filings** — Maryland is a Combined Federal/State Filing (CF/SF) participant for 1099-NEC, so federal filing covers state. Worth confirming each year.
7. **Backup withholding** — if a driver fails to provide a valid TIN or the IRS notifies us of a TIN mismatch, withhold **24%** of payments and remit to the IRS.

For Stripe-Connect-enrolled drivers, Stripe handles items 1, 2, 4, 5, and 7 automatically. PG Ride remains responsible for item 3 (tracking) and item 6 (annual state-filing confirmation).

For manual-payout drivers, PG Ride is on the hook for ALL seven items. See `docs/AH-073-manual-payout-1099-gap.md`.

---

## This doc is NOT legal or tax advice

Before any tax year closes, engage a CPA or tax attorney familiar with marketplace / 1099 platforms. Penalties for misfiled 1099s scale with intentional disregard.
