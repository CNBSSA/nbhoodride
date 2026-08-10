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
 * Feature-flag helper with safe defaults. Until config loads (or if it fails),
 * flags default to ENABLED so nothing that currently works suddenly vanishes;
 * lean mode only takes effect once the server explicitly reports a flag false.
 */
export function useFeatureFlags() {
  const { data } = useStripeConfig();
  return {
    walletEnabled: data?.walletEnabled ?? true,
    driverMarketplaceEnabled: data?.driverMarketplaceEnabled ?? true,
    equityProgramEnabled: data?.equityProgramEnabled ?? true,
  };
}
