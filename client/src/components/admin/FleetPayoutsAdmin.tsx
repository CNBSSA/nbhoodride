/**
 * A fleet's Friday payouts in Admin → Organizations → the fleet (Fleet
 * Management Accounts Plan, slice 4): each payout with where it goes and what
 * it covered, "Mark sent" once PG Ride has sent the money, and the year's
 * paid total with the business's legal name and full EIN — the record the
 * accountant files the fleet's year-end form from (no form is generated).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PayoutRow {
  id: string; label: string; amount: number; status: string; statusText: string; payoutMethod: string; payoutDetails: string; sentAt: string | null;
  covered: { rides: number; fees: number; from: string | null; to: string | null };
}
interface YearTotal { year: number; legalName: string; ein: string; paidTotal: number; payoutsSent: number; requestedNotSent: number; note: string }

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");
async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function FleetPayoutsAdmin({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const year = new Date().getFullYear();
  const { data } = useQuery<{ owedNow: number; payouts: PayoutRow[] }>({ queryKey: ["/api/admin/fleets", orgId, "payouts"], queryFn: () => json("GET", `/api/admin/fleets/${orgId}/payouts`), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const { data: yearTotal } = useQuery<YearTotal>({ queryKey: ["/api/admin/fleets", orgId, "earnings-by-year", year], queryFn: () => json("GET", `/api/admin/fleets/${orgId}/earnings-by-year?year=${year}`) });
  const sent = useMutation({
    mutationFn: (id: string) => json("POST", `/api/admin/fleet-payouts/${id}/sent`, {}),
    onSuccess: () => { toast({ title: "Marked sent", description: "The fleet's desk shows it as sent." }); queryClient.invalidateQueries({ queryKey: ["/api/admin/fleets", orgId] }); },
    onError: (e: Error) => toast({ title: "Could not mark it sent", description: e.message, variant: "destructive" }),
  });
  const payouts = data?.payouts ?? [];
  return (
    <Card data-testid={`fleet-payouts-admin-${orgId}`}>
      <CardHeader>
        <CardTitle className="text-base">Payouts</CardTitle>
        <CardDescription>The fleet's 25% of what its drivers earned in its cars, paid on the Friday run. Owed now, not yet on a payout: {usd(data?.owedNow ?? 0)}. Send each one to the account shown, then mark it sent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {payouts.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-payouts-admin">No payouts yet.</p>}
        {payouts.map((p) => (
          <div key={p.id} className="border rounded-md p-3 space-y-1" data-testid={`row-admin-fleet-payout-${p.id}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{p.label} · {usd(p.amount)}</span>
              <Badge variant={p.status === "sent" ? "default" : "outline"}>{p.statusText}</Badge>
              {p.status === "requested" && (
                <Button size="sm" className="ml-auto" disabled={sent.isPending}
                  onClick={() => { if (window.confirm(`Mark ${usd(p.amount)} to ${p.payoutMethod} ${p.payoutDetails} as sent?`)) sent.mutate(p.id); }}
                  data-testid={`button-fleet-payout-sent-${p.id}`}>Mark sent</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">To {p.payoutMethod} {p.payoutDetails} · covered {p.covered.rides} rides and {p.covered.fees} fees, {day(p.covered.from)} to {day(p.covered.to)}{p.sentAt ? ` · sent ${day(p.sentAt)}` : ""}</p>
          </div>
        ))}
        {yearTotal && (
          <p className="text-xs text-muted-foreground border-t pt-2" data-testid="text-fleet-year-total">
            {yearTotal.year}: {usd(yearTotal.paidTotal)} sent in {yearTotal.payoutsSent} payouts to {yearTotal.legalName}, EIN {yearTotal.ein}{yearTotal.requestedNotSent > 0 ? ` (${usd(yearTotal.requestedNotSent)} waiting to be sent)` : ""}. {yearTotal.note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
