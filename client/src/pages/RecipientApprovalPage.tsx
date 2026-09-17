/**
 * /approve/:token — the recipient of a delivery approves the delivery fee the
 * shop adds to their bill (shared/recipientApproval.ts). No account: the link
 * in the text is the capability. Shows the shop, what is coming, the fee and
 * the window; never the goods. No payment happens here — the shop collects
 * from the recipient itself and pays PG Ride as for any delivery.
 */
import { useEffect } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Package, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getCsrfToken } from "@/lib/queryClient";
import { BRAND } from "@shared/branding";

interface View { state: string; shopName: string; jobLabel: string; parcelLabel: string; fee: string; windowText: string | null; dropAddress: string | null; recipientName: string | null }

async function call<T>(method: string, url: string): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() ?? "" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

export default function RecipientApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const { data: view, isLoading, error, refetch } = useQuery<View>({ queryKey: ["/api/approve", token], queryFn: () => call<View>("GET", `/api/approve/${encodeURIComponent(token)}`), retry: false });
  useEffect(() => { document.title = `${BRAND.appName} · delivery fee`; }, []);
  const answer = (what: "approve" | "decline") => useMutation({
    mutationFn: () => call<{ state: string }>("POST", `/api/approve/${encodeURIComponent(token)}/${what}`),
    onSuccess: () => refetch(),
    onError: (e: Error) => toast({ title: "Could not record that", description: e.message, variant: "destructive" }),
  });
  const approve = answer("approve");
  const decline = answer("decline");

  const shell = (body: React.ReactNode, title: string, description?: string) => (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4" data-testid="recipient-approval">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4"><Package className="h-8 w-8 text-primary-foreground" /></div>
          <CardTitle className="text-2xl" data-testid="text-approve-title">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );

  if (isLoading) return shell(<p className="text-sm text-muted-foreground text-center">One moment…</p>, "Delivery fee");
  if (error || !view) return shell(<p className="text-sm text-muted-foreground text-center" data-testid="approve-invalid">{(error as Error)?.message ?? "This link is not valid."}</p>, "Link not valid");

  const facts = (
    <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">From</dt><dd className="font-medium" data-testid="text-approve-shop">{view.shopName}</dd>
      <dt className="text-muted-foreground">What</dt><dd>{view.parcelLabel}</dd>
      {view.windowText && <><dt className="text-muted-foreground">When</dt><dd>{view.windowText}</dd></>}
      {view.dropAddress && <><dt className="text-muted-foreground">To</dt><dd>{view.dropAddress}</dd></>}
      <dt className="text-muted-foreground">Delivery fee</dt><dd className="font-semibold" data-testid="text-approve-fee">${view.fee}</dd>
    </dl>
  );

  if (view.state === "approved") return shell(<div className="space-y-3 text-center"><CheckCircle className="h-10 w-10 text-green-600 mx-auto" /><p className="text-sm" data-testid="approve-approved">Thank you. A {BRAND.appName} driver will bring your order from {view.shopName}. You will get a text when it is on its way.</p>{facts}</div>, "Approved");
  if (view.state === "declined") return shell(<div className="space-y-3 text-center"><XCircle className="h-10 w-10 text-muted-foreground mx-auto" /><p className="text-sm" data-testid="approve-declined">You declined the delivery fee. {view.shopName} has been told. Changed your mind? You can still approve below.</p>{facts}<Button className="w-full min-h-[44px]" onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-approve-yes">Approve ${view.fee} after all</Button></div>, "Declined");
  if (view.state === "expired") return shell(<div className="space-y-3 text-center"><p className="text-sm" data-testid="approve-expired">The delivery window has passed, so this order was not sent. Contact {view.shopName} if you still want it.</p>{facts}</div>, "Too late");
  if (view.state === "cancelled" || view.state === "none") return shell(<div className="space-y-3 text-center"><p className="text-sm" data-testid="approve-closed">This delivery no longer needs your answer. Contact {view.shopName} with any question.</p>{facts}</div>, "Nothing to do");

  return shell(
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{view.shopName} is sending you an order by {BRAND.appName} and adds the delivery fee to your bill. Approve it and a driver brings your order. The fee is for the delivery only; the shop handles the order and the payment itself.</p>
      {facts}
      <Button className="w-full min-h-[44px]" onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-approve-yes">{approve.isPending ? "One moment…" : `Approve the $${view.fee} delivery fee`}</Button>
      <Button variant="ghost" className="w-full min-h-[44px]" disabled={decline.isPending} onClick={() => { if (window.confirm(`Decline the delivery from ${view.shopName}? They will be told.`)) decline.mutate(); }} data-testid="button-approve-no">No thanks</Button>
    </div>,
    "Approve the delivery fee", `${view.jobLabel} · ${view.shopName}`);
}
