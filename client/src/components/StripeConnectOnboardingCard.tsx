// AH-060: card shown on the driver dashboard to prompt Stripe Connect
// onboarding. Renders only when the driver is approved AND
// stripe_connect_payouts_enabled is false. Once Stripe verification is
// complete the card disappears and the wallet "Withdraw" button becomes
// enabled instead.

import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";

interface ConnectStatus {
  connectAccountId: string | null;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  onboardingCompleted: boolean;
  requirementsCurrentlyDue: string[];
}

interface Props {
  status: ConnectStatus | undefined;
}

export default function StripeConnectOnboardingCard({ status }: Props) {
  const { toast } = useToast();

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver/connect/onboard");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't start payout setup",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Don't render when payouts are already live — the dashboard's existing
  // wallet card takes over from here.
  if (!status || status.payoutsEnabled) return null;

  // detailsSubmitted but not payoutsEnabled = Stripe is still verifying.
  // Show a softer "in progress" state with a link back to the return page
  // where the polling UI lives.
  if (status.onboardingCompleted) {
    return (
      <Card className="border-yellow-200 dark:border-yellow-900">
        <CardContent className="p-4 flex items-start gap-3">
          <Loader2 className="h-5 w-5 mt-0.5 animate-spin text-yellow-600" />
          <div className="flex-1">
            <p className="font-semibold">Stripe is verifying your account</p>
            <p className="text-sm text-muted-foreground">
              Bank and identity verification usually takes a few minutes.
              You'll be able to transfer your wallet balance to your bank
              as soon as Stripe finishes.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 dark:border-blue-900">
      <CardContent className="p-4 flex items-start gap-3">
        <ShieldCheck className="h-6 w-6 mt-0.5 text-blue-600 shrink-0" />
        <div className="flex-1 space-y-2">
          <div>
            <p className="font-semibold">Set up payouts to your bank</p>
            <p className="text-sm text-muted-foreground">
              PG Ride uses Stripe to send your earnings straight to your
              bank account. Stripe collects your W-9 and issues your
              1099-NEC in January — so you don't have to chase paperwork.
              Takes 3–5 minutes.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid="button-connect-start"
          >
            {startMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening Stripe…</>
            ) : "Set up payouts"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
