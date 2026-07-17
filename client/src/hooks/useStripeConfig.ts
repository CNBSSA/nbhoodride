import { useQuery } from "@tanstack/react-query";

export interface StripeConfig {
  enabled: boolean;
  topUpEnabled: boolean;
  cardOnFileEnabled: boolean;
}

export function useStripeConfig() {
  return useQuery<StripeConfig>({
    queryKey: ["/api/payment/config"],
    staleTime: 60_000,
  });
}
