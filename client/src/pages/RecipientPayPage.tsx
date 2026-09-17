/**
 * /pay/:token — the recipient of a delivery approves and pays the delivery
 * fee (shared/recipientPay.ts). No account: the link in the text is the
 * capability. Shows the shop, what is coming, the fee and the window; never
 * the food price. Card payment through Stripe's Payment Element; the page
 * then asks the server to confirm with Stripe directly, so a late webhook
 * cannot leave a paid job held.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Package, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getCsrfToken } from "@/lib/queryClient";
import { useStripeLoader } from "@/lib/stripeLoader";
import { BRAND } from "@shared/branding";

interface View {
  state: string; shopName: string; jobLabel: string; parcelLabel: string; fee: string; windowText: string | null;
  dropAddress: string | null; recipientName: string | null; cardPayments: boolean; paymentIntentId: string | null;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

function PayForm({ token, fee, onPaid }: { token: string; fee: string; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: {} });
      if (error) { toast({ title: "Payment did not go through", description: error.message, variant: "destructive" }); return; }
      if (paymentIntent) await call("POST", `/api/pay/${encodeURIComponent(token)}/confirm`, { paymentIntentId: paymentIntent.id });
      onPaid();
    } catch (err: any) {
      toast({ title: "Could not confirm the payment", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      <Button type="submit" className="w-full min-h-[44px]" disabled={!stripe || busy} data-testid="button-pay-confirm">{busy ? "Paying…" : `Pay $${fee}`}</Button>
    </form>
  );
}

export default function RecipientPayPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const { stripe, status: stripeStatus } = useStripeLoader();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const { data: view, isLoading, error, refetch } = useQuery<View>({ queryKey: ["/api/pay", token], queryFn: () => call<View>("GET", `/api/pay/${encodeURIComponent(token)}`), retry: false });
  useEffect(() => { document.title = `${BRAND.appName} · delivery fee`; }, []);

  const start = useMutation({
    mutationFn: () => call<{ clientSecret: string }>("POST", `/api/pay/${encodeURIComponent(token)}/intent`),
    onSuccess: (r) => setClientSecret(r.clientSecret),
    onError: (e: Error) => toast({ title: "Could not start the payment", description: e.message, variant: "destructive" }),
  });
  const decline = useMutation({
    mutationFn: () => call<{ state: string }>("POST", `/api/pay/${encodeURIComponent(token)}/decline`),
    onSuccess: () => { setClientSecret(null); refetch(); },
    onError: (e: Error) => toast({ title: "Could not record that", description: e.message, variant: "destructive" }),
  });

  const shell = (body: React.ReactNode, title: string, description?: string) => (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4" data-testid="recipient-pay">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4"><Package className="h-8 w-8 text-primary-foreground" /></div>
          <CardTitle className="text-2xl" data-testid="text-pay-title">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );

  if (isLoading) return shell(<p className="text-sm text-muted-foreground text-center">One moment…</p>, "Delivery fee");
  if (error || !view) return shell(<p className="text-sm text-muted-foreground text-center" data-testid="pay-invalid">{(error as Error)?.message ?? "This link is not valid."}</p>, "Link not valid");

  const facts = (
    <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">From</dt><dd className="font-medium" data-testid="text-pay-shop">{view.shopName}</dd>
      <dt className="text-muted-foreground">What</dt><dd>{view.parcelLabel}</dd>
      {view.windowText && <><dt className="text-muted-foreground">When</dt><dd>{view.windowText}</dd></>}
      {view.dropAddress && <><dt className="text-muted-foreground">To</dt><dd>{view.dropAddress}</dd></>}
      <dt className="text-muted-foreground">Delivery fee</dt><dd className="font-semibold" data-testid="text-pay-fee">${view.fee}</dd>
    </dl>
  );

  if (view.state === "paid") return shell(<div className="space-y-3 text-center"><CheckCircle className="h-10 w-10 text-green-600 mx-auto" /><p className="text-sm" data-testid="pay-paid">Paid, thank you. A {BRAND.appName} driver will bring your order from {view.shopName}. You will get a text when it is on its way.</p>{facts}</div>, "Paid");
  if (view.state === "declined") return shell(<div className="space-y-3 text-center"><XCircle className="h-10 w-10 text-muted-foreground mx-auto" /><p className="text-sm" data-testid="pay-declined">You declined this delivery fee. {view.shopName} has been told. Changed your mind? You can still pay below.</p>{facts}<Button className="w-full min-h-[44px]" onClick={() => start.mutate()} disabled={start.isPending || !view.cardPayments} data-testid="button-pay-now">Pay ${view.fee} after all</Button></div>, "Declined");
  if (view.state === "refunded" || view.state === "refund_pending") return shell(<div className="space-y-3 text-center"><p className="text-sm" data-testid="pay-refunded">Your ${view.fee} delivery fee for the order from {view.shopName} {view.state === "refunded" ? "has been refunded" : "is being refunded"}. Nothing more to do.</p>{facts}</div>, "Refunded");
  if (view.state === "expired") return shell(<div className="space-y-3 text-center"><p className="text-sm" data-testid="pay-expired">The delivery window has passed, so this order was not sent. Contact {view.shopName} if you still want it.</p>{facts}</div>, "Too late");

  return shell(
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{view.shopName} is sending you an order by {BRAND.appName}. Approve the delivery fee and a driver brings it. The fee is for the delivery only; the shop handles the order itself.</p>
      {facts}
      {clientSecret && stripe ? (
        <Elements stripe={stripe} options={{ clientSecret, appearance: { theme: "stripe" } }}>
          <PayForm token={token} fee={view.fee} onPaid={() => { setClientSecret(null); refetch(); }} />
        </Elements>
      ) : (
        <>
          {!view.cardPayments || stripeStatus === "unconfigured" || stripeStatus === "failed" ? (
            <p className="text-sm text-amber-700" data-testid="pay-unavailable">Card payments are not available right now. Try again shortly, or tell {view.shopName}.</p>
          ) : null}
          <Button className="w-full min-h-[44px]" onClick={() => start.mutate()} disabled={start.isPending || !view.cardPayments || stripeStatus !== "ready"} data-testid="button-pay-now">
            {start.isPending ? "One moment…" : `Approve and pay $${view.fee}`}
          </Button>
        </>
      )}
      <Button variant="ghost" className="w-full min-h-[44px]" disabled={decline.isPending} onClick={() => { if (window.confirm(`Decline the delivery from ${view.shopName}? They will be told.`)) decline.mutate(); }} data-testid="button-pay-decline">No thanks</Button>
    </div>,
    "Approve the delivery fee", `${view.jobLabel} · ${view.shopName}`);
}
