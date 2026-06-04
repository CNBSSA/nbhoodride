// AH-060: landing page Stripe sends drivers back to after the hosted
// Connect Express onboarding flow. Same URL is used for both Stripe's
// return_url (success) and refresh_url (abandoned / expired link) — the
// page polls /api/driver/connect/status and renders one of three states:
//
//   1. payoutsEnabled=true  → "All set" + CTA back to dashboard
//   2. detailsSubmitted, payouts not yet enabled → "Verification in progress"
//      (Stripe is finalising; come back later)
//   3. otherwise → "Setup incomplete" + button to mint a fresh link
//
// We poll for 30s after returning. account.updated webhook usually beats
// the user back to the app, but the polling guards against a delayed
// webhook delivery and gives the SPA something to do other than spin.

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";

interface ConnectStatus {
  connectAccountId: string | null;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  onboardingCompleted: boolean;
  requirementsCurrentlyDue: string[];
}

export default function StripeConnectReturn() {
  const queryClient = useQueryClient();
  // pollCount lives in a ref, not React state — otherwise putting it in
  // the useEffect deps below caused a render-loop that synchronously
  // drove it from 0 → 15 in one tick (each setPollCount re-fires the
  // effect, which immediately bumps again). The display "Still
  // checking…" vs "Check again" needs a re-render trigger, so we mirror
  // it in `pollDisplay`, but the *increment* happens only when a real
  // refetch lands via the query callback.
  const pollCountRef = useRef(0);
  const [pollDisplay, setPollDisplay] = useState(0);

  const { data: status, isLoading, refetch } = useQuery<ConnectStatus>({
    queryKey: ["/api/driver/connect/status"],
    // Poll every 2s for the first 15 attempts (~30s) if not yet enabled.
    // Once enabled we stop polling — there's nothing else to wait for.
    refetchInterval: (q) => {
      const data = q.state.data as ConnectStatus | undefined;
      if (data?.payoutsEnabled) return false;
      if (pollCountRef.current >= 15) return false;
      pollCountRef.current += 1;
      setPollDisplay(pollCountRef.current);
      return 2000;
    },
  });

  useEffect(() => {
    if (status?.payoutsEnabled) {
      // Bust the user query so the dashboard sees the updated flags too.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  }, [status?.payoutsEnabled, queryClient]);

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver/connect/onboard");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4 text-center">
          {isLoading ? (
            <>
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Checking your payout setup…</p>
            </>
          ) : status?.payoutsEnabled ? (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-600" />
              <h1 className="text-xl font-semibold">Payouts are set up</h1>
              <p className="text-sm text-muted-foreground">
                Stripe has verified your information. You can now transfer
                your wallet balance straight to your bank, and your 1099-NEC
                will be issued by Stripe in January.
              </p>
              <Link href="/">
                <Button className="w-full" data-testid="button-connect-return-home">
                  Back to Dashboard
                </Button>
              </Link>
            </>
          ) : status?.onboardingCompleted ? (
            <>
              <Clock className="w-12 h-12 mx-auto text-yellow-500" />
              <h1 className="text-xl font-semibold">Verification in progress</h1>
              <p className="text-sm text-muted-foreground">
                Thanks — Stripe is reviewing your information. Bank
                verification can take a few minutes after you link an
                account. You'll be able to request payouts as soon as
                Stripe finishes.
              </p>
              {pollDisplay < 15 ? (
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Still checking…
                </p>
              ) : (
                <Button variant="outline" onClick={() => { pollCountRef.current = 0; setPollDisplay(0); refetch(); }}>
                  Check again
                </Button>
              )}
              <Link href="/">
                <Button variant="link" className="w-full" data-testid="button-connect-return-home">
                  Back to Dashboard
                </Button>
              </Link>
            </>
          ) : (
            <>
              <AlertCircle className="w-12 h-12 mx-auto text-orange-500" />
              <h1 className="text-xl font-semibold">Setup not finished</h1>
              <p className="text-sm text-muted-foreground">
                It looks like you didn't finish setting up payouts with
                Stripe. You can resume where you left off — no information
                you entered is lost.
              </p>
              <Button
                className="w-full"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                data-testid="button-connect-resume"
              >
                {resumeMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</>
                ) : "Resume setup"}
              </Button>
              <Link href="/">
                <Button variant="link" className="w-full">
                  Back to Dashboard
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
