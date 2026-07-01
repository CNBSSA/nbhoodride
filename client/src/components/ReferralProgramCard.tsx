import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Gift, Copy, Check } from "lucide-react";

interface CommunityReferral {
  id: string;
  referralCode: string;
  status: string;
  creditAmount?: string | null;
  referredId?: string | null;
  createdAt?: string;
}

interface ReferralMineResponse {
  referrals: CommunityReferral[];
  stats: {
    codesCreated: number;
    codesRedeemed: number;
    creditPerReferral: string;
  };
  hasRedeemedCode: boolean;
  redeemedReferral: CommunityReferral | null;
}

/** C4 referral program — generate codes, copy link, redeem (API existed; this is the UI). */
export function ReferralProgramCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [redeemCode, setRedeemCode] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ReferralMineResponse>({
    queryKey: ["/api/trust/referrals/mine"],
  });

  const createReferral = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/trust/referrals", { chainType: "rider_rider" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust/referrals/mine"] });
      toast({ title: "Referral code created", description: "Share it with a neighbor — you both earn $5 credit." });
    },
    onError: () => {
      toast({ title: "Could not create code", variant: "destructive" });
    },
  });

  const redeemReferral = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/trust/referrals/redeem", { code: code.trim().toUpperCase() });
      return res.json();
    },
    onSuccess: () => {
      setRedeemCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/trust/referrals/mine"] });
      toast({ title: "Code redeemed!", description: "$5 community credit applied to your account." });
    },
    onError: async (err: Error) => {
      toast({
        title: "Could not redeem",
        description: err.message || "Invalid or already-used code.",
        variant: "destructive",
      });
    },
  });

  const copyLink = async (referral: CommunityReferral) => {
    const url = `${window.location.origin}/profile?ref=${referral.referralCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(referral.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (isLoading) return null;

  const pendingCodes = data?.referrals.filter((r) => r.status === "pending") ?? [];
  const credit = data?.stats.creditPerReferral ?? "5.00";

  return (
    <div className="space-y-4" data-testid="referral-program-card">
      <div className="flex items-start gap-2">
        <Gift className="w-5 h-5 text-purple-600 mt-0.5" />
        <div>
          <p className="font-medium">Neighbor referrals</p>
          <p className="text-sm text-muted-foreground">
            Invite PG County neighbors — ${parseFloat(credit).toFixed(0)} credit each when they join and ride.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">{data?.stats.codesCreated ?? 0} codes created</Badge>
        <Badge variant="outline">{data?.stats.codesRedeemed ?? 0} redeemed</Badge>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => createReferral.mutate()}
        disabled={createReferral.isPending}
        data-testid="button-create-referral"
      >
        {createReferral.isPending ? "Creating…" : "Generate new referral code"}
      </Button>

      {pendingCodes.length > 0 && (
        <ul className="space-y-2">
          {pendingCodes.map((ref) => (
            <li
              key={ref.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              data-testid={`referral-code-${ref.referralCode}`}
            >
              <span className="font-mono font-semibold tracking-wide">{ref.referralCode}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => copyLink(ref)}
                data-testid={`button-copy-referral-${ref.referralCode}`}
              >
                {copiedId === ref.id ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!data?.hasRedeemedCode ? (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-sm font-medium">Have a code?</p>
          <div className="flex gap-2">
            <Input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              placeholder="Enter referral code"
              className="font-mono uppercase"
              data-testid="input-redeem-referral"
            />
            <Button
              onClick={() => redeemReferral.mutate(redeemCode)}
              disabled={!redeemCode.trim() || redeemReferral.isPending}
              data-testid="button-redeem-referral"
            >
              Redeem
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2" data-testid="referral-already-redeemed">
          You&apos;ve already redeemed a neighbor referral code.
        </p>
      )}
    </div>
  );
}
