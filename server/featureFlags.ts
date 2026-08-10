// Feature flags for "Stripe-lean mode".
//
// PG Ride's full product includes three things that make payment processors
// (Stripe in particular) classify the business as restricted:
//   - a stored-value wallet ("Virtual PG Card" top-up)  -> money transmission
//   - driver payouts / marketplace                       -> unlicensed aggregator
//   - a driver-equity / ownership program                -> securities issuer
//
// None of that is needed to run a plain per-ride card-charge rideshare. These
// flags let a deployment present to Stripe as a simple "charge a rider for a
// ride" service, while ALL of the wallet / driver / equity code stays in the
// repo, ready to re-enable once the business is licensed (money transmitter),
// on Stripe Connect (drivers), and cleared by securities counsel (equity).
//
// Enforcement per flag:
//   - walletEnabled:false  — HARD: switches ride payment to card-on-file only,
//     reports topUpEnabled:false, and REFUSES the top-up endpoints (403). No
//     stored value can be loaded or held.
//   - driverMarketplaceEnabled:false / equityProgramEnabled:false — UI-level:
//     hides those surfaces from the app a reviewer sees. The underlying
//     authenticated endpoints remain (so the owner can still operate); they are
//     simply not surfaced. Gate them server-side too if you need hard refusal.
//
// Default: ENABLED (current behaviour) — a deployment opts into lean mode by
// setting the env var to a falsey value ("false", "0", "off", "no").

// Unset/empty => default. When the operator sets a value, only an explicitly
// truthy token keeps the feature ON; ANYTHING else (including a typo like
// "disabled" or "FALSE!") turns it OFF. This fails safe toward the compliance
// direction — a misconfigured disable never silently leaves a restricted
// surface enabled.
function flag(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return def;
  return /^(true|1|on|yes)$/i.test(raw.trim());
}

export const featureFlags = {
  /** Stored-value wallet + top-up ("Virtual PG Card"). Off => ride payment is card-on-file only. */
  walletEnabled: flag(process.env.WALLET_ENABLED, true),
  /** Driver signup / earnings / payouts (the marketplace). Off => rider-only app. */
  driverMarketplaceEnabled: flag(process.env.DRIVER_MARKETPLACE_ENABLED, true),
  /** Driver-equity / ownership / profit distributions. Off => hidden entirely. */
  equityProgramEnabled: flag(process.env.EQUITY_PROGRAM_ENABLED, true),
} as const;

export type FeatureFlags = typeof featureFlags;
