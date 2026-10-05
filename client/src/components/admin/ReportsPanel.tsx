/**
 * Admin → Reports (2026-10-05): read-only views of production data that until
 * now needed SQL in Railway's database console (server/adminReports.ts).
 *
 * - Reliability timeline: what the server recorded in a window, by kind and by
 *   hour, with the hourly "watch ran" heartbeats. Heartbeats inside a window
 *   mean the server was alive and working; heartbeats that stop mean it was
 *   not. One tap loads the 2026-09-30 outage window.
 * - Rider balances: riders who still hold money in the balance the Virtual PG
 *   Card used to show, how much, and what put it there (work order #451).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Timeline {
  from: string; to: string; total: number; lastHeartbeat: string | null; truncated: boolean;
  byKind: { kind: string; count: number }[];
  byHour: { hour: string; count: number; heartbeats: number }[];
  events: { at: string; kind: string; page: string | null; message: string }[];
}
interface Balances {
  riders: number; total: number; listed: number;
  bySource: { reason: string; entries: number; amount: number }[];
  list: { userId: string; name: string; email: string; balance: number; lastCredit: string | null; lastCreditOn: string | null }[];
}

const OUTAGE = { from: "2026-09-30T03:00Z", to: "2026-09-30T08:00Z" };
const money = (n: number) => `$${n.toFixed(2)}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `${res.status}`);
  return data as T;
}

export function ReportsPanel() {
  const [from, setFrom] = useState(OUTAGE.from);
  const [to, setTo] = useState(OUTAGE.to);
  const [win, setWin] = useState(OUTAGE);
  const timeline = useQuery<Timeline>({
    queryKey: ["/api/admin/reports/reliability-events", win.from, win.to],
    queryFn: () => getJson<Timeline>(`/api/admin/reports/reliability-events?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`),
    retry: false,
  });
  const balances = useQuery<Balances>({
    queryKey: ["/api/admin/reports/rider-balances"],
    queryFn: () => getJson<Balances>("/api/admin/reports/rider-balances"),
    retry: false,
  });
  const t = timeline.data;
  const b = balances.data;

  return (
    <div className="space-y-6" data-testid="reports-panel">
      <div>
        <h2 className="text-2xl font-bold">Reports</h2>
        <p className="text-sm text-muted-foreground">Read-only views of production data. Nothing on this page changes anything. Times are UTC.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Reliability timeline</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            What the server recorded about itself in a window. It writes a <strong>watch ran</strong> heartbeat about every hour while it is working:
            heartbeats all through a window mean it was alive; heartbeats that stop mean it was stuck.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">From
              <Input value={from} onChange={(e) => setFrom(e.target.value)} className="w-52" data-testid="input-report-from" />
            </label>
            <label className="text-xs text-muted-foreground">To
              <Input value={to} onChange={(e) => setTo(e.target.value)} className="w-52" data-testid="input-report-to" />
            </label>
            <Button onClick={() => setWin({ from, to })} data-testid="button-report-events-run">Show</Button>
            <Button variant="outline" onClick={() => { setFrom(OUTAGE.from); setTo(OUTAGE.to); setWin(OUTAGE); }} data-testid="button-report-outage-window">30 Sep outage window</Button>
          </div>
          {timeline.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {timeline.error && <p className="text-sm text-red-600" data-testid="report-events-error">{(timeline.error as Error).message}</p>}
          {t && (
            <div className="space-y-3" data-testid="report-events">
              <p className="text-sm" data-testid="report-events-summary">
                <strong>{t.total}</strong> event{t.total === 1 ? "" : "s"} from {t.from.slice(0, 16).replace("T", " ")} to {t.to.slice(0, 16).replace("T", " ")}.{" "}
                {t.lastHeartbeat ? <>Last heartbeat in the window: <strong>{t.lastHeartbeat.slice(0, 19).replace("T", " ")}</strong>.</> : <strong>No heartbeat in this window.</strong>}
              </p>
              {t.byHour.length > 0 && (
                <table className="text-sm w-full max-w-md">
                  <thead><tr className="text-left text-muted-foreground"><th>Hour (UTC)</th><th>Events</th><th>Heartbeats</th></tr></thead>
                  <tbody>{t.byHour.map((h) => (
                    <tr key={h.hour}><td>{h.hour.slice(0, 16).replace("T", " ")}</td><td>{h.count}</td><td>{h.heartbeats}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {t.byKind.length > 0 && <p className="text-xs text-muted-foreground">By kind: {t.byKind.map((k) => `${k.kind} ${k.count}`).join(" · ")}</p>}
              {t.events.length > 0 && (
                <div className="max-h-72 overflow-auto border rounded-md text-xs">
                  {t.events.map((e, i) => (
                    <div key={i} className="px-2 py-1 border-b last:border-0">
                      <span className="font-mono">{e.at.slice(11, 19)}</span> <strong>{e.kind}</strong>{e.page ? ` · ${e.page}` : ""}{e.message ? ` — ${e.message}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {t.truncated && <p className="text-xs text-muted-foreground">Showing the first {t.events.length}; narrow the window to see the rest.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rider balances</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Riders (not drivers or car owners) who still hold money in the balance the Virtual PG Card used to show, and what put it there.
          </p>
          <Button variant="outline" size="sm" onClick={() => balances.refetch()} data-testid="button-report-balances-refresh">Refresh</Button>
          {balances.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {balances.error && <p className="text-sm text-red-600">{(balances.error as Error).message}</p>}
          {b && (
            <div className="space-y-3" data-testid="report-balances">
              <p className="text-sm" data-testid="report-balances-summary">
                <strong>{b.riders}</strong> rider{b.riders === 1 ? "" : "s"} hold a balance, <strong>{money(b.total)}</strong> in all.
              </p>
              {b.bySource.length > 0 && (
                <table className="text-sm w-full max-w-md">
                  <thead><tr className="text-left text-muted-foreground"><th>Put there by</th><th>Entries</th><th>Amount</th></tr></thead>
                  <tbody>{b.bySource.map((s) => (
                    <tr key={s.reason}><td>{s.reason}</td><td>{s.entries}</td><td>{money(s.amount)}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {b.list.length > 0 && (
                <div className="max-h-72 overflow-auto border rounded-md text-xs">
                  {b.list.map((r) => (
                    <div key={r.userId} className="px-2 py-1 border-b last:border-0 flex justify-between gap-2">
                      <span>{r.name} · {r.email}</span>
                      <span>{money(r.balance)}{r.lastCredit ? ` · last: ${r.lastCredit}${r.lastCreditOn ? ` (${r.lastCreditOn})` : ""}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              {b.riders > b.listed && <p className="text-xs text-muted-foreground">Listing the {b.listed} largest; the count and total cover all {b.riders}.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
