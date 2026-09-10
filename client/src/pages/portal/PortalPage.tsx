/**
 * The requester portal — the desk side of commercial riders (slice 2).
 *
 * A clinic dispatcher, an office manager or a restaurant's front counter
 * books for their organization here. Desktop first: the next two days as a
 * board with a map, every job in a table, the month's statement, and the
 * people who may book. Keyboard throughout: N opens the booking form,
 * Escape closes it, Ctrl+Enter books. Still usable on a phone.
 *
 * Everything on this page comes from /api/org/*, which only answers for
 * organizations the signed-in person belongs to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { usePwaInstallPrompt } from "@/hooks/usePwaInstallPrompt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { JobsMap } from "@/components/portal/JobsMap";
import { StandingOrdersView } from "@/components/portal/StandingOrdersView";
import { BillingView } from "@/components/portal/BillingView";
import { CATEGORY_LABELS, ORG_ROLES, canBook, canManageMembers, canSeeStatement, currentMonthKey, formatJobNumber, type CommercialCategory, type OrgRole } from "@shared/commercial";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { BRAND } from "@shared/branding";
import { CalendarDays, ListChecks, Receipt, Users, Plus, Download, Printer, ArrowLeft, Repeat, Landmark } from "lucide-react";

interface Org { id: string; name: string; category: CommercialCategory; status: string; facilityFee: string; billingMode: string }
interface Membership { organization: Org; role: OrgRole }
interface JobRow {
  id: string; jobNumber: number; rideId: string; status: string; scheduledAt: string | null; createdAt: string; completedAt: string | null;
  passengerName: string | null; passengerPhone: string | null; pickup: { lat: number; lng: number; address: string }; destination: { lat: number; lng: number; address: string };
  vehicleType: string | null; estimatedFare: string | null; actualFare: string | null; facilityFee: string; waitFee: string; cancellationFee: string;
  poNumber: string | null; notes: string | null; driverName: string | null; total: number; proof?: { receivedBy?: string } | null; delivery?: string | null;
}
interface Member { userId: string; role: OrgRole; firstName: string | null; lastName: string | null; email: string | null }
interface StatementLine { jobNumber: number; at: string; passenger: string; from: string; to: string; status: string; fare: string | null; facilityFee: string; waitFee: string; cancellationFee: string }
interface Statement { window: { label: string; monthKey: string }; lines: StatementLine[]; totals: { completed: number; cancelled: number; fares: number; facilityFees: number; waitFees: number; cancellationFees: number; total: number } }

type View = "today" | "jobs" | "standing" | "statement" | "billing" | "people";

const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const eastern = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", ...opts }) : "";
const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = { completed: "default", cancelled: "destructive", no_show: "destructive", pending: "outline", accepted: "secondary", driver_arriving: "secondary", in_progress: "secondary" };
const STATUS_WORDS: Record<string, string> = { pending: "waiting for a driver", accepted: "driver assigned", driver_arriving: "driver on the way", in_progress: "on the road", completed: "done", cancelled: "cancelled", no_show: "no show" };
const CANCELLABLE = new Set(["pending", "accepted", "driver_arriving"]);

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}
const isTyping = () => { const t = document.activeElement as HTMLElement | null; return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); };

export default function PortalPage() {
  const { user } = useAuth();
  const { data: memberships, isLoading, error } = useQuery<Membership[]>({ queryKey: ["/api/org/mine"], queryFn: () => json("GET", "/api/org/mine") });
  const [orgId, setOrgId] = useState<string | null>(null);
  const [view, setView] = useState<View>("today");
  const [booking, setBooking] = useState(false);
  const active = useMemo(() => (memberships ?? []).find((m) => m.organization.id === (orgId ?? memberships?.[0]?.organization.id)) ?? null, [memberships, orgId]);
  const { canInstall, install } = usePwaInstallPrompt();
  const { toast } = useToast();

  // N opens the booking form from anywhere on the page; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setBooking(false); return; }
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping() && active && canBook(active.role)) { e.preventDefault(); setBooking(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground" data-testid="portal-loading">Loading your organizations…</div>;
  if (error || !memberships || memberships.length === 0) {
    return (
      <div className="min-h-screen bg-background p-8 max-w-xl mx-auto space-y-4" data-testid="portal-empty">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back to the app</Link>
        <h1 className="text-2xl font-bold">{BRAND.appName} for organizations</h1>
        <p className="text-muted-foreground">Your account is not attached to an organization yet. Ask the person who runs your account with {BRAND.appName} to add your email, then open this page again.</p>
      </div>
    );
  }
  if (!active) return null;
  const org = active.organization;
  const role = active.role;

  const nav: Array<{ id: View; label: string; icon: any; show: boolean }> = [
    { id: "today", label: "Next 48 hours", icon: CalendarDays, show: true },
    { id: "jobs", label: "All jobs", icon: ListChecks, show: true },
    { id: "standing", label: "Standing orders", icon: Repeat, show: true },
    { id: "statement", label: "Statement", icon: Receipt, show: canSeeStatement(role) },
    { id: "billing", label: "Billing", icon: Landmark, show: canSeeStatement(role) },
    { id: "people", label: "People", icon: Users, show: canManageMembers(role) },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="portal">
      <header className="border-b bg-card">
        <div className="flex items-center gap-3 px-4 md:px-6 h-14">
          <Link href="/" className="text-muted-foreground hover:text-foreground" title="Back to the app" data-testid="link-portal-back"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="font-semibold truncate">{BRAND.appName}</div>
          <span className="text-muted-foreground hidden sm:inline">·</span>
          {memberships.length > 1 ? (
            <Select value={org.id} onValueChange={(v) => { setOrgId(v); setView("today"); }}>
              <SelectTrigger className="w-64 h-9" data-testid="select-portal-org"><SelectValue /></SelectTrigger>
              <SelectContent>{memberships.map((m) => <SelectItem key={m.organization.id} value={m.organization.id}>{m.organization.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : <div className="truncate" data-testid="text-portal-org">{org.name}</div>}
          <Badge variant="outline" className="hidden sm:inline-flex">{role}</Badge>
          {org.status !== "active" && <Badge variant="destructive">paused</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {canInstall && (
              <Button variant="outline" size="sm" onClick={async () => { const ok = await install(); if (ok) toast({ title: "Installed", description: `${BRAND.appName} now opens from your taskbar.` }); }} data-testid="button-portal-install">
                Install on this computer
              </Button>
            )}
            {canBook(role) && (
              <Button size="sm" onClick={() => setBooking(true)} disabled={org.status !== "active"} data-testid="button-portal-book" title="Press N">
                <Plus className="h-4 w-4 mr-1" /> Book a job
              </Button>
            )}
            <span className="text-xs text-muted-foreground hidden md:inline">{user?.firstName}</span>
          </div>
        </div>
      </header>

      <div className="md:grid md:grid-cols-[200px_1fr]">
        <nav className="border-b md:border-b-0 md:border-r bg-card md:min-h-[calc(100vh-3.5rem)]">
          <ul className="flex md:flex-col overflow-x-auto md:overflow-visible">
            {nav.filter((n) => n.show).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setView(n.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap w-full text-left border-b-2 md:border-b-0 md:border-l-2 ${view === n.id ? "border-primary text-foreground font-medium bg-muted/40" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  data-testid={`tab-portal-${n.id}`}
                >
                  <n.icon className="h-4 w-4" /> {n.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="hidden md:block px-4 py-3 text-xs text-muted-foreground">{CATEGORY_LABELS[org.category] ?? org.category}. Facility fee {money(org.facilityFee)} per completed job. Press <kbd className="px-1 border rounded">N</kbd> to book.</p>
          <TermsNote orgId={org.id} />
        </nav>

        <main className="p-4 md:p-6 space-y-6 min-w-0">
          {view === "today" && <TodayBoard org={org} onBook={() => setBooking(true)} canBook={canBook(role)} />}
          {view === "jobs" && <JobsList org={org} canCancel={canBook(role)} />}
          {view === "standing" && <StandingOrdersView orgId={org.id} canBook={canBook(role)} />}
          {view === "statement" && canSeeStatement(role) && <StatementView org={org} />}
          {view === "billing" && canSeeStatement(role) && <BillingView orgId={org.id} />}
          {view === "people" && canManageMembers(role) && <PeopleView org={org} />}
        </main>
      </div>

      {booking && <BookJobDrawer org={org} onClose={() => setBooking(false)} />}
    </div>
  );
}

/** The organization's own cancellation, no-show and waiting terms, in words. */
function TermsNote({ orgId }: { orgId: string }) {
  const { data } = useQuery<{ termsText?: string }>({ queryKey: ["/api/org", orgId, "detail"], queryFn: () => json("GET", `/api/org/${orgId}`) });
  if (!data?.termsText) return null;
  return <p className="hidden md:block px-4 pb-4 text-xs text-muted-foreground" data-testid="text-portal-terms">{data.termsText}</p>;
}

function useJobs(orgId: string, from: Date, to: Date, refetchMs?: number) {
  const key = ["/api/org", orgId, "jobs", from.toISOString(), to.toISOString()];
  return useQuery<JobRow[]>({ queryKey: key, queryFn: () => json("GET", `/api/org/${orgId}/jobs?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`), refetchInterval: refetchMs });
}
const invalidateJobs = (orgId: string) => queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "jobs"] });

function TodayBoard({ org, onBook, canBook: mayBook }: { org: Org; onBook: () => void; canBook: boolean }) {
  const [range] = useState(() => ({ from: new Date(Date.now() - 6 * 3_600_000), to: new Date(Date.now() + 48 * 3_600_000) }));
  const { data: jobs = [], isLoading } = useJobs(org.id, range.from, range.to, 20_000);
  const upcoming = useMemo(() => [...jobs].filter((j) => j.status !== "cancelled" && j.status !== "no_show").sort((a, b) => new Date(a.scheduledAt ?? a.createdAt).getTime() - new Date(b.scheduledAt ?? b.createdAt).getTime()), [jobs]);
  const needDriver = upcoming.filter((j) => j.status === "pending").length;
  return (
    <section className="space-y-4" data-testid="portal-today">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Next 48 hours</h1>
          <p className="text-sm text-muted-foreground">{upcoming.length} job{upcoming.length === 1 ? "" : "s"}{needDriver > 0 ? ` · ${needDriver} still need a driver` : upcoming.length > 0 ? " · every job has a driver or is done" : ""}. Refreshes every 20 seconds.</p>
        </div>
        {mayBook && <Button variant="outline" size="sm" onClick={onBook} data-testid="button-portal-book-inline"><Plus className="h-4 w-4 mr-1" /> Book a job</Button>}
      </div>
      <div className="grid grid-cols-1 2xl:grid-cols-[1fr_380px] gap-4">
        <div className="rounded-lg border bg-card overflow-x-auto">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : upcoming.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="text-portal-no-jobs">Nothing booked for the next two days.{mayBook ? " Press N to book a job." : ""}</p>
          ) : (
            <table className="w-full text-sm table-fixed min-w-[640px]">
              <colgroup><col className="w-[110px]" /><col className="w-[84px]" /><col className="w-[130px]" /><col /><col className="w-[150px]" /><col className="w-[96px]" /></colgroup>
              <thead className="text-xs uppercase text-muted-foreground bg-muted/40"><tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Job</th><th className="text-left px-3 py-2">Passenger</th><th className="text-left px-3 py-2">Trip</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Driver</th></tr></thead>
              <tbody>
                {upcoming.map((j) => (
                  <tr key={j.id} className="border-t" data-testid={`row-portal-job-${j.id}`}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{eastern(j.scheduledAt ?? j.createdAt, { weekday: "short", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{formatJobNumber(j.jobNumber)}</td>
                    <td className="px-3 py-2 truncate">{j.passengerName}</td>
                    <td className="px-3 py-2"><div className="truncate">{j.pickup?.address}</div><div className="truncate text-muted-foreground">to {j.destination?.address}</div>{j.delivery ? <div className="truncate text-xs text-muted-foreground">{j.delivery}</div> : null}</td>
                    <td className="px-3 py-2"><Badge variant={tone[j.status] ?? "outline"} className="whitespace-nowrap">{STATUS_WORDS[j.status] ?? j.status}</Badge></td>
                    <td className="px-3 py-2 truncate">{j.driverName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <JobsMap jobs={upcoming} height="300px" />
      </div>
    </section>
  );
}

const RANGES: Array<{ id: string; label: string; from: () => Date; to: () => Date }> = [
  { id: "next7", label: "Next 7 days", from: () => new Date(Date.now() - 3_600_000), to: () => new Date(Date.now() + 7 * 86_400_000) },
  { id: "thisweek", label: "Past 7 days", from: () => new Date(Date.now() - 7 * 86_400_000), to: () => new Date(Date.now() + 3_600_000) },
  { id: "month", label: "Past 30 days", from: () => new Date(Date.now() - 30 * 86_400_000), to: () => new Date(Date.now() + 30 * 86_400_000) },
];

function JobsList({ org, canCancel }: { org: Org; canCancel: boolean }) {
  const { toast } = useToast();
  const [rangeId, setRangeId] = useState("next7");
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const [window_] = useState(() => ({ from: range.from(), to: range.to() }));
  const bounds = useMemo(() => ({ from: range.from(), to: range.to() }), [rangeId]);
  void window_;
  const { data: jobs = [], isLoading } = useJobs(org.id, bounds.from, bounds.to);
  const cancel = useMutation({
    mutationFn: (jobId: string) => json<{ cancellationFee: string }>("POST", `/api/org/${org.id}/jobs/${jobId}/cancel`, { reason: "Cancelled by the organization" }),
    onSuccess: (r) => { invalidateJobs(org.id); toast({ title: "Job cancelled", description: Number(r.cancellationFee) > 0 ? `A ${money(r.cancellationFee)} cancellation fee applies.` : "No fee." }); },
    onError: (e: Error) => toast({ title: "Could not cancel", description: e.message, variant: "destructive" }),
  });
  return (
    <section className="space-y-4" data-testid="portal-jobs">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-2">All jobs</h1>
        {RANGES.map((r) => (
          <Button key={r.id} size="sm" variant={r.id === rangeId ? "default" : "outline"} onClick={() => setRangeId(r.id)} data-testid={`chip-portal-range-${r.id}`}>{r.label}</Button>
        ))}
      </div>
      <div className="rounded-lg border bg-card overflow-x-auto">
        {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : jobs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No jobs in this range.</p> : (
          <table className="w-full text-sm table-fixed min-w-[820px]">
            <colgroup><col className="w-[170px]" /><col className="w-[96px]" /><col className="w-[140px]" /><col /><col className="w-[150px]" /><col className="w-[96px]" /><col className="w-[90px]" /><col className="w-[84px]" /></colgroup>
            <thead className="text-xs uppercase text-muted-foreground bg-muted/40"><tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Job</th><th className="text-left px-3 py-2">Passenger</th><th className="text-left px-3 py-2">Trip</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Driver</th><th className="text-right px-3 py-2">Billed</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t" data-testid={`row-portal-job-${j.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{eastern(j.scheduledAt ?? j.createdAt)}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{formatJobNumber(j.jobNumber)}{j.poNumber ? <div className="text-xs text-muted-foreground truncate">{j.poNumber}</div> : null}</td>
                  <td className="px-3 py-2 truncate">{j.passengerName}</td>
                  <td className="px-3 py-2"><div className="truncate">{j.pickup?.address}</div><div className="truncate text-muted-foreground">to {j.destination?.address}</div>{j.delivery ? <div className="truncate text-xs text-muted-foreground">{j.delivery}</div> : null}</td>
                  <td className="px-3 py-2"><Badge variant={tone[j.status] ?? "outline"} className="whitespace-nowrap">{STATUS_WORDS[j.status] ?? j.status}</Badge></td>
                  <td className="px-3 py-2">{j.driverName ?? "—"}{j.proof?.receivedBy ? <div className="text-xs text-muted-foreground">received by {j.proof.receivedBy}</div> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(j.total)}</td>
                  <td className="px-3 py-2 text-right">
                    {canCancel && CANCELLABLE.has(j.status) && (
                      <Button variant="ghost" size="sm" onClick={() => { if (window.confirm(`Cancel ${formatJobNumber(j.jobNumber)} for ${j.passengerName ?? "this passenger"}?`)) cancel.mutate(j.id); }} data-testid={`button-portal-cancel-job-${j.id}`}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function StatementView({ org }: { org: Org }) {
  const [month, setMonth] = useState(currentMonthKey());
  const { data: s, isLoading } = useQuery<Statement>({ queryKey: ["/api/org", org.id, "statement", month], queryFn: () => json("GET", `/api/org/${org.id}/statement?month=${month}`) });
  const base = `/api/org/${org.id}/statement?month=${month}`;
  return (
    <section className="space-y-4" data-testid="portal-statement">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Statement</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="input-portal-statement-month" />
        <Button asChild variant="outline" size="sm"><a href={`${base}&format=csv`} data-testid="link-portal-statement-csv"><Download className="h-4 w-4 mr-1" /> CSV</a></Button>
        <Button asChild variant="outline" size="sm"><a href={`${base}&format=html`} target="_blank" rel="noreferrer" data-testid="link-portal-statement-print"><Printer className="h-4 w-4 mr-1" /> Print</a></Button>
      </div>
      {isLoading || !s ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Completed jobs", String(s.totals.completed)], ["Cancelled", String(s.totals.cancelled)], ["Fares and fees", money(s.totals.fares + s.totals.facilityFees + s.totals.waitFees)], [`Total for ${s.window.label}`, money(s.totals.total)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums" data-testid={`stat-portal-${k.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{v}</div></div>
            ))}
          </div>
          <div className="rounded-lg border bg-card overflow-x-auto">
            {s.lines.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No billable jobs in {s.window.label}.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground bg-muted/40"><tr><th className="text-left px-3 py-2">Job</th><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Passenger</th><th className="text-left px-3 py-2">Trip</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Fare</th><th className="text-right px-3 py-2">Facility fee</th><th className="text-right px-3 py-2">Waiting</th><th className="text-right px-3 py-2">Cancellation</th></tr></thead>
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.jobNumber} className="border-t">
                      <td className="px-3 py-2 font-mono">{formatJobNumber(l.jobNumber)}</td><td className="px-3 py-2 whitespace-nowrap">{eastern(l.at)}</td><td className="px-3 py-2">{l.passenger}</td>
                      <td className="px-3 py-2 max-w-[18rem]"><div className="truncate">{l.from}</div><div className="truncate text-muted-foreground">to {l.to}</div></td>
                      <td className="px-3 py-2"><Badge variant={tone[l.status] ?? "outline"} className="whitespace-nowrap">{STATUS_WORDS[l.status] ?? l.status}</Badge></td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.status === "completed" ? money(l.fare) : ""}</td><td className="px-3 py-2 text-right tabular-nums">{l.status === "completed" ? money(l.facilityFee) : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.status === "completed" ? money(l.waitFee) : ""}</td><td className="px-3 py-2 text-right tabular-nums">{l.status === "completed" ? "" : money(l.cancellationFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function PeopleView({ org }: { org: Org }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: members = [] } = useQuery<Member[]>({ queryKey: ["/api/org", org.id, "members"], queryFn: () => json("GET", `/api/org/${org.id}/members`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("requester");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/org", org.id, "members"] });
  const add = useMutation({
    mutationFn: () => json<Member>("POST", `/api/org/${org.id}/members`, { email, role }),
    onSuccess: (m) => { setEmail(""); refresh(); toast({ title: "Person added", description: `${m.firstName ?? ""} ${m.lastName ?? ""} is now ${m.role} for ${org.name}.` }); },
    onError: (e: Error) => toast({ title: "Could not add them", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => json("DELETE", `/api/org/${org.id}/members/${userId}`),
    onSuccess: () => { refresh(); toast({ title: "Person removed" }); },
    onError: (e: Error) => toast({ title: "Could not remove them", description: e.message, variant: "destructive" }),
  });
  return (
    <section className="space-y-4 max-w-3xl" data-testid="portal-people">
      <div><h1 className="text-xl font-semibold">People</h1><p className="text-sm text-muted-foreground">Owners do everything. Requesters book. Billing sees statements. Each person needs a {BRAND.appName} account first, signed up with the email you enter here.</p></div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input placeholder="Email of their PG Ride account" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) add.mutate(); }} data-testid="input-portal-member-email" />
        <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
          <SelectTrigger className="sm:w-40" data-testid="select-portal-member-role"><SelectValue /></SelectTrigger>
          <SelectContent>{ORG_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <Button disabled={!email.trim() || add.isPending} onClick={() => add.mutate()} data-testid="button-portal-add-member">Add</Button>
      </div>
      <ul className="rounded-lg border bg-card divide-y text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`row-portal-member-${m.userId}`}>
            <span><span className="font-medium">{m.firstName} {m.lastName}</span> <span className="text-muted-foreground">{m.email}</span></span>
            <span className="flex items-center gap-2"><Badge variant="outline">{m.role}</Badge>{m.userId !== user?.id && <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)} data-testid={`button-portal-remove-member-${m.userId}`}>Remove</Button>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BookJobDrawer({ org, onClose }: { org: Org; onClose: () => void }) {
  const { toast } = useToast();
  const first = useRef<HTMLInputElement>(null);
  const [passengerName, setPassengerName] = useState("");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [pickup, setPickup] = useState<AddressSuggestion | null>(null);
  const [destText, setDestText] = useState("");
  const [dest, setDest] = useState<AddressSuggestion | null>(null);
  const [when, setWhen] = useState("");
  const [vehicleType, setVehicleType] = useState<string>("standard");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { first.current?.focus(); }, []);
  const ready = !!(passengerName.trim() && pickup && dest && when);
  const book = useMutation({
    mutationFn: () => json<{ job: { jobLabel: string }; ride: { estimatedFare: string; scheduledAt: string } }>("POST", `/api/org/${org.id}/jobs`, {
      passengerName, passengerPhone,
      pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label },
      destination: { lat: dest!.lat, lng: dest!.lng, address: dest!.label },
      scheduledAt: new Date(when).toISOString(), vehicleType, poNumber, notes,
    }),
    onSuccess: (r) => {
      invalidateJobs(org.id);
      toast({ title: `Booked ${r.job.jobLabel}`, description: `${eastern(r.ride.scheduledAt)} · ${money(r.ride.estimatedFare)} fare plus ${money(org.facilityFee)} facility fee.` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Could not book it", description: e.message, variant: "destructive" }),
  });
  const submit = useCallback(() => { if (ready && !book.isPending) book.mutate(); }, [ready, book]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="Book a job" data-testid="portal-book-drawer">
      <div className="w-full sm:w-[480px] h-full bg-background shadow-xl overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Book a job for {org.name}</h2><Button variant="ghost" size="sm" onClick={onClose} data-testid="button-portal-close-book">Close</Button></div>
        <p className="text-xs text-muted-foreground">At least 3 hours ahead. Tab through the fields; Ctrl+Enter books.</p>
        <Input ref={first} placeholder="Passenger name" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} data-testid="input-portal-passenger-name" />
        <Input placeholder="Passenger phone (optional)" value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} data-testid="input-portal-passenger-phone" />
        <AddressAutocomplete value={pickupText} onChange={(v) => { setPickupText(v); setPickup(null); }} onSelect={(s) => { setPickup(s); setPickupText(s.label); }} placeholder="Pickup address" data-testid="input-portal-pickup" />
        <AddressAutocomplete value={destText} onChange={(v) => { setDestText(v); setDest(null); }} onSelect={(s) => { setDest(s); setDestText(s.label); }} placeholder="Destination address" data-testid="input-portal-destination" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="input-portal-when" />
          <Select value={vehicleType} onValueChange={setVehicleType}>
            <SelectTrigger data-testid="select-portal-vehicle"><SelectValue /></SelectTrigger>
            <SelectContent>{VEHICLE_TYPES.map((v) => <SelectItem key={v} value={v}>{VEHICLE_TYPE_LABELS[v]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Input placeholder="PO / reference (optional)" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} data-testid="input-portal-po" />
        <Textarea placeholder="Notes for the driver: door, wheelchair folds, ask for the nurse…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="input-portal-notes" />
        <Button className="w-full" disabled={!ready || book.isPending} onClick={submit} data-testid="button-portal-submit-job">{book.isPending ? "Booking…" : "Book job"}</Button>
      </div>
    </div>
  );
}
