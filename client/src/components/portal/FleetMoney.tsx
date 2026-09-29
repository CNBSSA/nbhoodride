/**
 * The fleet desk's money (PG Ride Fleet Management Accounts Plan, slice 4).
 *
 * Earnings: this week or last, per car and per driver — rides, fares, the
 * fleet's 25% of the drivers' share and the drivers' 75% — and every line.
 * Payouts: each Friday's payout, what it covered and whether PG Ride has
 * sent it. A fleet never sees a rider; the account a payout went to is shown
 * to the owner only. Every figure is the server's (server/fleet/money.ts).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Totals { rides: number; fares: number; gross: number; fleetShare: number; driversShare: number }
interface EarningsView {
  week: "this" | "last"; label: string; totals: Totals;
  byCar: Array<Totals & { fleetCarId: string; carLabel: string }>;
  byDriver: Array<Totals & { driverUserId: string; driverName: string }>;
  lines: Array<{ at: string; kindText: string; carLabel: string; driverName: string; fare: number; gross: number; fleetShare: number; driverKeeps: number; paid: boolean }>;
}
interface PayoutsView {
  role: string; owedNow: { amount: number; lines: number }; payoutOnFile: boolean;
  payouts: Array<{ id: string; label: string; amount: number; status: string; statusText: string; sentAt: string | null;
    covered: { rides: number; fees: number; from: string | null; to: string | null; amount: number }; payoutMethod?: string; payoutDetails?: string }>;
}

const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

async function json<T>(method: string, url: string): Promise<T> {
  const res = await apiRequest(method, url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

function TotalsRow({ label, t, testId }: { label: string; t: Totals; testId: string }) {
  return (
    <tr className="border-t" data-testid={testId}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2 text-right">{t.rides}</td>
      <td className="py-1 pr-2 text-right">{usd(t.fares)}</td>
      <td className="py-1 pr-2 text-right font-medium">{usd(t.fleetShare)}</td>
      <td className="py-1 text-right">{usd(t.driversShare)}</td>
    </tr>
  );
}

function TotalsTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; t: Totals }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr><th className="text-left font-normal">{title}</th><th className="text-right font-normal">Rides</th><th className="text-right font-normal">Fares</th><th className="text-right font-normal">Fleet 25%</th><th className="text-right font-normal">Drivers 75%</th></tr>
        </thead>
        <tbody>{rows.map((r) => <TotalsRow key={r.key} label={r.label} t={r.t} testId={`row-fleet-earnings-${r.key}`} />)}</tbody>
      </table>
    </div>
  );
}

export function FleetEarningsSection({ orgId }: { orgId: string }) {
  const [week, setWeek] = useState<"this" | "last">("this");
  const { data, isLoading, error } = useQuery<EarningsView>({
    queryKey: ["/api/fleet", orgId, "earnings", week], queryFn: () => json("GET", `/api/fleet/${orgId}/earnings?week=${week}`),
    refetchInterval: 60_000, refetchOnWindowFocus: true,
  });
  return (
    <div className="space-y-2" data-testid="fleet-earnings">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-medium">Earnings</p>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={week === "this" ? "default" : "outline"} onClick={() => setWeek("this")} data-testid="button-fleet-money-this-week">This week</Button>
          <Button size="sm" variant={week === "last" ? "default" : "outline"} onClick={() => setWeek("last")} data-testid="button-fleet-money-last-week">Last week</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">What your cars earned {data ? `(${data.label})` : ""}: the fleet's 25% of each driver's 85% of the fare. Tips are the drivers' and are not shown. Riders are never shown.</p>
      {isLoading && <p className="text-xs text-muted-foreground">Loading earnings…</p>}
      {error && <p className="text-xs text-destructive">{(error as Error).message}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="fleet-earnings-totals">
            <div className="border rounded-md p-2"><p className="text-xs text-muted-foreground">Rides</p><p className="font-medium" data-testid="text-fleet-earnings-rides">{data.totals.rides}</p></div>
            <div className="border rounded-md p-2"><p className="text-xs text-muted-foreground">Fleet's 25%</p><p className="font-medium" data-testid="text-fleet-earnings-share">{usd(data.totals.fleetShare)}</p></div>
            <div className="border rounded-md p-2"><p className="text-xs text-muted-foreground">Drivers' 75%</p><p className="font-medium" data-testid="text-fleet-earnings-drivers">{usd(data.totals.driversShare)}</p></div>
          </div>
          {data.lines.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-earnings">Nothing earned in your cars this {data.week === "last" ? "past" : ""} week yet.</p> : (
            <>
              <TotalsTable title="Per car" rows={data.byCar.map((c) => ({ key: `car-${c.fleetCarId}`, label: c.carLabel, t: c }))} />
              <TotalsTable title="Per driver" rows={data.byDriver.map((d) => ({ key: `driver-${d.driverUserId}`, label: d.driverName, t: d }))} />
              <div className="space-y-1" data-testid="fleet-earnings-lines">
                {data.lines.map((l, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{day(l.at)} · {l.kindText} · {l.carLabel} · {l.driverName}{l.fare ? ` · fare ${usd(l.fare)}` : ""} · fleet {usd(l.fleetShare)} · driver {usd(l.driverKeeps)}{l.paid ? " · paid" : ""}</p>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FleetPayoutsSection({ orgId }: { orgId: string }) {
  const { data, isLoading, error } = useQuery<PayoutsView>({ queryKey: ["/api/fleet", orgId, "payouts"], queryFn: () => json("GET", `/api/fleet/${orgId}/payouts`), refetchOnWindowFocus: true });
  return (
    <div className="space-y-2" data-testid="fleet-payouts">
      <p className="text-sm font-medium">Payouts</p>
      <p className="text-xs text-muted-foreground">PG Ride pays the fleet's share every Friday to the account on file, once it comes to $5 or more.</p>
      {isLoading && <p className="text-xs text-muted-foreground">Loading payouts…</p>}
      {error && <p className="text-xs text-destructive">{(error as Error).message}</p>}
      {data && (
        <>
          <p className="text-sm" data-testid="text-fleet-owed-now">Owed, to be paid on Friday: {usd(data.owedNow.amount)}{!data.payoutOnFile && data.owedNow.amount > 0 ? " · no payout method on file yet, so it waits" : ""}</p>
          {data.payouts.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-payouts">No payouts yet.</p>}
          {data.payouts.map((p) => (
            <div key={p.id} className="border rounded-md p-2 text-xs space-y-0.5" data-testid={`row-fleet-payout-${p.id}`}>
              <div className="flex items-center gap-2"><span className="font-medium text-sm">{p.label} · {usd(p.amount)}</span><Badge variant={p.status === "sent" ? "default" : "outline"}>{p.statusText}</Badge></div>
              <p className="text-muted-foreground">Covered {p.covered.rides} rides and {p.covered.fees} fees, {day(p.covered.from)} to {day(p.covered.to)}{p.sentAt ? ` · sent ${day(p.sentAt)}` : ""}</p>
              {p.payoutMethod && <p className="text-muted-foreground">To {p.payoutMethod} {p.payoutDetails}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
