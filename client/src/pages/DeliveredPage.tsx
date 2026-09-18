/**
 * /delivered/:token — what the receiver opens from the "delivered" text: the
 * shop, when, how it was handed over, and the photo while it is kept
 * (server/commercial/delivered.ts). No account; never the goods.
 */
import { useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND } from "@shared/branding";

interface View { shopName: string; jobLabel: string; deliveredAt: string | null; handoverText: string | null; hasPhoto: boolean; photoPending: boolean; photoRetired: boolean; dropAddress: string | null }

export default function DeliveredPage() {
  const { token } = useParams<{ token: string }>();
  const { data: view, isLoading, error } = useQuery<View>({
    queryKey: ["/api/delivered", token],
    queryFn: async () => { const r = await fetch(`/api/delivered/${encodeURIComponent(token)}`, { credentials: "include" }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.message || "This link is not valid."); return d as View; },
    retry: false,
  });
  useEffect(() => { document.title = `${BRAND.appName} · delivered`; }, []);
  const when = view?.deliveredAt ? new Date(view.deliveredAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4" data-testid="delivered-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4"><PackageCheck className="h-8 w-8 text-primary-foreground" /></div>
          <CardTitle className="text-2xl" data-testid="text-delivered-title">{isLoading ? "One moment" : error || !view ? "Link not valid" : "Delivered"}</CardTitle>
          {view && <CardDescription>{view.jobLabel} · {view.shopName}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error || (!isLoading && !view) ? <p className="text-muted-foreground text-center" data-testid="delivered-invalid">{(error as Error)?.message ?? "This link is not valid."}</p> : null}
          {view && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">From</dt><dd className="font-medium" data-testid="text-delivered-shop">{view.shopName}</dd>
                {when && <><dt className="text-muted-foreground">When</dt><dd>{when}</dd></>}
                {view.dropAddress && <><dt className="text-muted-foreground">To</dt><dd>{view.dropAddress}</dd></>}
                {view.handoverText && <><dt className="text-muted-foreground">Handover</dt><dd data-testid="text-delivered-handover">{view.handoverText}</dd></>}
              </dl>
              {view.hasPhoto ? (
                <img src={`/api/delivered/${encodeURIComponent(token)}/photo`} alt="Where the parcel was left" className="w-full rounded-lg border" data-testid="img-delivered-photo" />
              ) : view.photoPending ? (
                <p className="text-muted-foreground" data-testid="delivered-photo-pending">The driver's photo is still on their phone and will appear here once it uploads.</p>
              ) : view.photoRetired ? (
                <p className="text-muted-foreground" data-testid="delivered-photo-retired">The photo was kept for 90 days and has now been removed. The record of the handover stays.</p>
              ) : null}
              <p className="text-xs text-muted-foreground">Any question about the order itself goes to {view.shopName}.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
