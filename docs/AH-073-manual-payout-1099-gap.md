# AH-073 — Manual-payout drivers have no 1099-NEC / W-9 plan

**Severity:** High
**Product:** PG Ride
**Spun off from:** AH-060
**Last checked:** 2026-06-06
**Risk:** Direct IRS non-compliance for any manual-payout driver earning >$600 in a tax year. Same exposure as the original AH-060 finding; AH-060 only closed the gap for drivers who complete Stripe Connect onboarding.

---

## Summary

AH-060 was closed by routing payouts through Stripe Connect, which makes Stripe responsible for W-9 collection and 1099-NEC filing. That fix only covers drivers who have enrolled in Stripe Connect and have `stripeConnectPayoutsEnabled = true`.

The POST /api/driver/payout-requests handler at `server/routes.ts:4287` branches on `user.stripeConnectPayoutsEnabled`:

```ts
const useConnect = !!user.stripeConnectAccountId && user.stripeConnectPayoutsEnabled === true;
// ... if useConnect → Stripe Transfer → Stripe issues 1099
// ... else → manual flow (Zelle / CashApp / PayPal / check) → NO 1099 PATH
```

Every driver on the `else` branch — legacy users from before AH-060 shipped, new signups still in onboarding, anyone who refuses Stripe Connect's KYC — is still in the original AH-060 risk pool. Their payouts are recorded in `payout_requests` and `wallet_transactions`, but no W-9 is ever collected and no 1099 is ever filed.

If any of these drivers cross $600 in calendar year 2026 (or any year), PG Ride is non-compliant. IRS penalty: $310 per missed/late form with intentional-disregard escalation if it's a pattern.

---

## Affected population (estimate needed)

How many drivers are likely to fall in this bucket needs a query, not a guess. Suggested:

```sql
SELECT u.id, u.email, u.stripeConnectPayoutsEnabled,
       SUM(CASE WHEN pr.status = 'paid' THEN pr.amount::numeric ELSE 0 END) AS paid_ytd
FROM users u
LEFT JOIN payout_requests pr
  ON pr.driverId = u.id
 AND pr.processedAt >= date_trunc('year', NOW())
WHERE u.isDriver = true
GROUP BY u.id
HAVING SUM(CASE WHEN pr.status = 'paid' THEN pr.amount::numeric ELSE 0 END) > 0
ORDER BY paid_ytd DESC;
```

The drivers where `stripeConnectPayoutsEnabled IS NOT TRUE AND paid_ytd > 0` are the at-risk population for this tax year. Any of them >$600 are an immediate compliance gap.

---

## Three remediation options

### Option 1 — Mandatory Stripe Connect (recommended)

Make Stripe Connect enrollment a precondition for ANY payout. Existing manual-payout drivers see a one-time prompt to complete Connect onboarding before their next payout request goes through. New signups can't get paid until they enroll.

**Pros:** zero new code beyond a precondition check; the 1099 problem stays Stripe's. No ongoing maintenance.

**Cons:** UX-aggressive — some drivers may refuse Stripe's identity verification. Some may not have bank accounts or may have credit issues that block Connect enrollment. We lose those drivers, or have to fall back to one of the other two options for them anyway.

**Scope:** ~1 day. Precondition check in POST /api/driver/payout-requests, banner in driver dashboard reminding non-enrolled drivers, deadline notice to existing manual-payout drivers (60-day window).

### Option 2 — Implement Path B (Tax1099-style fallback)

Build the W-9 collection + year-end filing pipeline described in the AH-060 design doc's Path B section. Manual-payout drivers fill out a W-9 in our UI; we encrypt TIN at rest, aggregate annual earnings nightly, and push to Tax1099 in January.

**Pros:** drivers keep their existing payout methods. No forced migration. Catches profit-distribution income too (if classified as 1099-NEC).

**Cons:** ~2-3 weeks of focused work, ownership of TIN encryption + IRS TIN matching + backup withholding. Each year-end is engineering risk.

**Scope:** new tables, driver-side W-9 UI, admin tax-year report, nightly aggregation cron, year-end Tax1099 API integration, backup-withholding hook.

### Option 3 — Sunset the manual payout flow

Announce a hard deadline (e.g., end of Q3 2026) after which manual payouts stop. Drivers who haven't enrolled in Stripe Connect by then see their wallet balance frozen until they do. Combined with Option 1 for new drivers.

**Pros:** clean break, lowest long-term complexity, no Tax1099 dependency.

**Cons:** social-political friction with existing drivers. May coincide with peak driver acquisition season. Need a clear escalation path for drivers blocked by Stripe's KYC.

---

## Recommendation

**Option 1 + Option 3 in sequence.**
- Immediately: precondition check on all new payout requests requiring Stripe Connect (Option 1). New signups can't earn into the manual flow.
- Q3 2026: hard sunset of the manual flow for existing drivers (Option 3). 60-day notice via email and dashboard banner; freeze wallet payouts (not earnings) after the deadline for drivers who haven't enrolled.

Option 2 only if a CPA review (see AH-060 outstanding gap #5) concludes profit distributions are 1099-NEC and Stripe Connect can't capture them, OR if the population of Connect-rejected drivers turns out to be material.

---

## What this doc is NOT

Not legal or tax advice. The CPA / tax-attorney engagement called out in AH-060 needs to bless any path picked here.

---

## Related

- [AH-060](./AH-060-tax-1099-w9-design.md) — the parent finding that AH-073 spun off from.
