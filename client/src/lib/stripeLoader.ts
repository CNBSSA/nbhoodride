/**
 * Stripe.js, loaded when a payment form needs it — not on every app open.
 *
 * Until now two screens called loadStripe() at module load, so every visit
 * to the app, signed in or not, downloaded Stripe's script; on a weak
 * signal or behind an ad blocker the download failed as an unhandled
 * rejection ("Failed to load Stripe.js"), paged the operator with a
 * meaningless "not signed in" alert, and — worse — left the card form
 * blank with no message and no way to retry.
 *
 * Here the script is fetched on first use, the promise is cached while it
 * is in flight or succeeded, and a failure clears the cache so Retry really
 * retries. The failure is reported once, in words that say what happened.
 */
import { useCallback, useEffect, useState } from "react";
import type { Stripe } from "@stripe/stripe-js";
import { reportClientError } from "@/lib/reportClientError";

export const STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLIC_KEY as string | undefined) || "";

/** What a rider is told when the script cannot be downloaded. */
export const STRIPE_LOAD_FAILED_MESSAGE =
  "We couldn't reach our payment provider. Check your connection or turn off an ad blocker for this site, then try again.";

let pending: Promise<Stripe | null> | null = null;

/** Exposed for tests. */
export function _resetStripeLoader(): void {
  pending = null;
}

/**
 * Load Stripe.js once. Resolves null when no publishable key is configured
 * (the app treats that as "card payments not activated yet"). Rejects when
 * the script cannot be downloaded; the next call tries again.
 */
export function getStripe(loader?: (key: string) => Promise<Stripe | null>): Promise<Stripe | null> {
  if (!STRIPE_PUBLISHABLE_KEY) return Promise.resolve(null);
  if (pending) return pending;
  const load = loader ?? ((key: string) => import("@stripe/stripe-js").then((m) => m.loadStripe(key)));
  pending = load(STRIPE_PUBLISHABLE_KEY).catch((err) => {
    pending = null;
    reportClientError({ message: `Stripe.js could not be downloaded (blocked or offline): ${String((err as any)?.message ?? err).slice(0, 120)}` });
    throw err;
  });
  return pending;
}

export type StripeLoadStatus = "unconfigured" | "loading" | "ready" | "failed";

/** The Stripe instance for a payment form, with a status and a real retry. */
export function useStripeLoader(): { stripe: Stripe | null; status: StripeLoadStatus; retry: () => void } {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [status, setStatus] = useState<StripeLoadStatus>(STRIPE_PUBLISHABLE_KEY ? "loading" : "unconfigured");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!STRIPE_PUBLISHABLE_KEY) return;
    let cancelled = false;
    setStatus("loading");
    getStripe().then(
      (s) => { if (!cancelled) { setStripe(s); setStatus(s ? "ready" : "unconfigured"); } },
      () => { if (!cancelled) setStatus("failed"); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { stripe, status, retry };
}
