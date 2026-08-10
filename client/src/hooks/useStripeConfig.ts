import { useQuery } from "@tanstack/react-query";

export interface StripeConfig {
  enabled: boolean;
  topUpEnabled: boolean;
  cardOnFileEnabled: boolean;
  // Lean-mode feature flags (default true when the endpoint is unreachable, so
  // existing behaviour is preserved if config hasn't loaded yet).
  walletEnabled: boolean;
  driverMarketplaceEnabled: boolean;
  equityProgramEnabled: boolean;
}

export function useStripeConfig() {
  return useQuery<StripeConfig>({
    queryKey: ["/api/payment/config"],
    staleTime: 60_000,
  });
}

/**
 * Feature-flag helper — fails CLOSED. The restricted surfaces (stored-value
 * wallet, driver marketplace, equity program) render only once the server has
 * positively confirmed the flag is enabled. Until /api/payment/config loads — or
 * if it fails — they stay hidden, so a lean deployment never flashes them to a
 * payment-processor reviewer. This is purely presentational: the server's own
 * env flags remain the source of truth for the payment logic, so hiding a
 * surface for a few hundred ms on a full deployment never affects money.
 */
export function useFeatureFlags() {
  const { data } = useStripeConfig();
  return {
    walletEnabled: data?.walletEnabled ?? false,
    driverMarketplaceEnabled: data?.driverMarketplaceEnabled ?? false,
    equityProgramEnabled: data?.equityProgramEnabled ?? false,
  };
}
