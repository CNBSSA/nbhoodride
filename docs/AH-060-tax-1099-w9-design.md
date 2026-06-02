# AH-060 — IRS 1099-NEC + W-9 collection for drivers

**Status:** Design proposal — not yet implemented.
**Risk if unaddressed:** Direct IRS non-compliance for any tax year a driver earns over $600. Penalties currently $310 per missed/late form, with intentional-disregard escalation. Plus drivers won't receive the 1099-NEC they need to file their own returns.

## What the IRS requires

For each contractor (driver) paid **$600 or more in a calendar year**, PG Ride as the payer must:

1. **Collect a W-9** before any payment, containing:
   - Legal name (or business name if pass-through entity)
   - Federal tax classification (individual / sole prop / LLC / corp)
   - Address
   - **TIN** (SSN for individuals, EIN for businesses)
   - Signature attesting accuracy
2. **Validate the TIN** — at minimum format-check; ideally match against IRS TIN matching service.
3. **Track gross payments per driver per calendar year** — including ride payouts, tips, bonuses, profit distributions if 1099-able.
4. **Generate 1099-NEC** by **Jan 31 of the following year** to both the driver and the IRS, for every driver who crossed $600.
5. **File with the IRS** electronically (FIRE / IRIS) or by paper.
6. **State filings** — Maryland is a Combined Federal/State Filing (CF/SF) participant for 1099-NEC, so federal filing covers state. Worth confirming each year.
7. **Backup withholding** — if a driver fails to provide a valid TIN or the IRS notifies us of a TIN mismatch, withhold **24%** of payments and remit to the IRS.

## Three implementation paths

Pick one before implementation begins. Each has materially different scope.

### Path A — Stripe Connect (recommended if Stripe is already in the stack)

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

**Scope:**
- Add `stripeConnectAccountId` to `driver_profiles` (idempotent ALTER).
- Driver onboarding step: redirect to Stripe Connect Onboarding (account link).
- Payout flow rewrite: `stripe.transfers.create({ destination: stripeAccountId, amount })`.
- Admin payout page: read transfer status from Stripe instead of manual records.
- ~1 week of focused work.

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

**Scope:**
- New tables: `driver_tax_info` (W-9 fields + verification status), `driver_annual_earnings` (gross per calendar year, recalculated nightly).
- New driver UI: W-9 collection form, with TIN encryption at rest.
- New admin UI: review W-9 status per driver, see annual earnings.
- Nightly cron: aggregate prior day's earnings into `driver_annual_earnings`.
- Year-end script (early January): post W-2-eligible drivers to Tax1099 API, store filing receipts.
- Backup withholding hook in the payout path.

### Path C — Manual filing (smallest scope, only viable for <50 drivers)

Collect W-9s manually (PDF upload), store them encrypted, and have an admin do the 1099-NEC filing through the IRS [IRIS portal](https://www.irs.gov/iris) at year-end.

**Pros:**
- Lowest engineering cost — basically just W-9 PDF storage and year-end earnings report.
- No external dependencies.

**Cons:**
- Doesn't scale. Manual filing 50+ 1099s in IRIS is many hours of admin time, error-prone.
- Backup withholding still has to be computed and remitted manually.
- TIN validation is on us (no automation).
- High operational risk during the January crunch.

**Scope:**
- W-9 PDF upload component (reuse `DocumentUploadModal` pattern).
- Encrypted blob storage (server/objectStorage already supports this).
- Admin "Tax Year" report page that lists every driver who earned ≥$600.
- ~1 week of focused work, plus annual admin labor.

## Recommendation

**Pick Path A (Stripe Connect) if you're committed to Stripe for payments anyway.** It compounds well with the split-payment work already done in PR #22 — once driver-side accounts exist, the payouts can flow through Stripe end-to-end. The 1099 problem becomes Stripe's problem.

**Pick Path B if you've decided to keep the multi-channel payout flow** (Zelle / CashApp / PayPal / check). It's the right amount of investment for a mid-stage product.

**Pick Path C only as a stopgap** if you need to be compliant *this* calendar year and don't have engineering time before December.

## Open questions for Festus / business

1. How many active drivers are projected to earn ≥$600 in calendar year 2026?
2. What's the current payout split between channels (Zelle vs CashApp vs PayPal vs check)? If <20% of payouts go through one channel, consolidating onto Stripe Connect is even more attractive.
3. Are profit distributions (`profit_distributions` table) 1099-able earnings, or are they K-1 / share-cert distributions? If K-1, they're handled separately under partnership/S-corp rules.
4. Maryland: confirm the state still participates in CF/SF for 1099-NEC for the relevant tax year before relying on Stripe / Tax1099 to handle state filings.

## What this design doc is NOT

This is **not** legal or tax advice. Before shipping any 1099 flow, engage a CPA or tax attorney who is familiar with marketplace / 1099 platforms. Penalties for misfiled 1099s scale with intentional disregard; getting this wrong is materially worse than not doing it at all.

## What's blocking implementation today

A business decision on which of the three paths to take. Once chosen, I can break the work into PR-sized chunks following the same pattern as the onboarding audit work (small, audited, revertable).
