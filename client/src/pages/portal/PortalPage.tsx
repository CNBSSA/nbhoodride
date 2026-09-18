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
import { BookDeliveryDrawer, type DeliveryPrefill } from "@/components/portal/BookDeliveryDrawer";
import { describeProof, type DeliveryProof } from "@shared/deliveries";
import { describeApproval } from "@shared/recipientApproval";
import { forgetBusinessHome } from "@/lib/businessHome";
import { CATEGORY_LABELS, ORG_ROLES, canBook, canManageMembers, canSeeStatement, categoryMayBook, currentMonthKey, formatJobNumber, type CommercialCategory, type OrgRole } from "@shared/commercial";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { BRAND } from "@shared/branding";
import { CalendarDays, ListChecks, Receipt, Users, Plus, Download, Printer, ArrowLeft, Repeat, Landmark, Package, Car, BookUser } from "lucide-react";

interface Org { id: string; name: string; category: CommercialCategory; status: string; facilityFee: string; billingMode: string; askRecipientByDefault?: boolean; address?: { lat?: number; lng?: number; address?: string } | null }
interface Membership { organization: Org; role: OrgRole }
interface JobRow {
  id: string; jobNumber: number; rideId: string; status: string; scheduledAt: string | null; createdAt: string; completedAt: string | null;
  passengerName: string | null; passengerPhone: string | null; pickup: { lat: number; lng: number; address: string }; destination: { lat: number; lng: number; address: string };
  vehicleType: string | null; estimatedFare: string | null; actualFare: string | null; facilityFee: string; waitFee: string; cancellationFee: string;
  poNumber: string | null; notes: string | null; driverName: string | null; total: number; proof?: DeliveryProof | null; delivery?: string | null; handover?: string | null;
  recipientApproval?: string; recipientApprovalToken?: string | null; recipientFee?: string | null;
  parcel?: { parcelSize: string; handover: string; pickupContact: { name?: string; phone?: string | null } | null; dropContact: { name?: string; phone?: string | null; note?: string | null } | null } | null;
}
interface Member { userId: string; role: OrgRole; firstName: string | null; lastName: string | null; email: string | null }
interface StatementLine { jobNumber: number; at: string; passenger: string; from: string; to: string; status: string; fare: string | null; facilityFee: string; waitFee: string; cancellationFee: string }
interface Statement { window: { label: string; monthKey: string }; lines: StatementLine[]; totals: { completed: number; cancelled: number; fares: number; facilityFees: number; waitFees: number; cancellationFees: number; total: number } }

type View = "today" | "jobs" | "standing" | "recipients" | "statement" | "billing" | "people";

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
  const isAdmin = !!(user as any)?.isAdmin || !!(user as any)?.isSuperAdmin;
  const { data: memberships, isLoading, error } = useQuery<Membership[]>({ queryKey: ["/api/org/mine"], queryFn: () => json("GET", "/api/org/mine") });
  // `?org=<id>` opens a particular account directly — a link a clerk can
  // bookmark when they belong to more than one.
  const [orgId, setOrgId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get("org"); } catch { return null; }
  });
  const [view, setView] = useState<View>("today");
  const [booking, setBooking] = useState(false);
  const [sendingParcel, setSendingParcel] = useState(false);
  const [parcelPrefill, setParcelPrefill] = useState<DeliveryPrefill | null>(null);
  const sendAgain = (pre: DeliveryPrefill) => { setParcelPrefill(pre); setSendingParcel(true); };
  const active = useMemo(() => (memberships ?? []).find((m) => m.organization.id === (orgId ?? memberships?.[0]?.organization.id)) ?? null, [memberships, orgId]);
  const { canInstall, install } = usePwaInstallPrompt();
  const { toast } = useToast();

  // N opens the booking form from anywhere on the page; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setBooking(false); setSendingParcel(false); setParcelPrefill(null); return; }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping() && active && canBook(active.role);
      if ((e.key === "n" || e.key === "N") && plain) { e.preventDefault(); setBooking(true); }
      if ((e.key === "p" || e.key === "P") && plain && categoryMayBook(active.organization.category, "delivery")) { e.preventDefault(); setSendingParcel(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground" data-testid="portal-loading">Loading your organizations…</div>;
  if (error || !memberships || memberships.length === 0) {
    // An operator who just created accounts is not "waiting to be added by
    // someone" — they ARE that someone. Telling the admin to go and ask
    // themselves is how this page read the first time it was used for real.
    return (
      <div className="min-h-screen bg-background p-8 max-w-xl mx-auto space-y-4" data-testid="portal-empty">
        <Link href="/" onClick={forgetBusinessHome} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back to the app</Link>
        <h1 className="text-2xl font-bold">{BRAND.appName} for organizations</h1>
        {isAdmin ? (
          <>
            <p className="text-muted-foreground" data-testid="portal-empty-admin">
              Creating an account does not put you in it. You are not a member of any organization yet,
              so there is nothing to show here.
            </p>
            <p className="text-muted-foreground">
              Open <strong>Admin → Organizations</strong>, pick the account, and add your own email as an
              owner. Then this page opens on it.
            </p>
            <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium" data-testid="button-portal-to-admin">
              Go to Admin → Organizations
            </Link>
          </>
        ) : (
          <p className="text-muted-foreground">
            Your account is not attached to an organization yet. Ask the person who runs your account
            with {BRAND.appName} to add your email, then open this page again.
          </p>
        )}
      </div>
    );
  }
  if (!active) return null;
  const org = active.organization;
  const role = active.role;
  // Business and food accounts send parcels as well as book rides. The
  // parcel drawer existed from the day deliveries shipped and nothing on
  // this page opened it — the one door a delivery account exists for.
  const parcels = categoryMayBook(org.category, "delivery");

  const nav: Array<{ id: View; label: string; icon: any; show: boolean }> = [
    { id: "today", label: "Next 48 hours", icon: CalendarDays, show: true },
    { id: "jobs", label: "All jobs", icon: ListChecks, show: true },
    { id: "standing", label: "Standing orders", icon: Repeat, show: true },
    { id: "recipients", label: "Recipients", icon: BookUser, show: parcels && canBook(role) },
    { id: "statement", label: "Statement", icon: Receipt, show: canSeeStatement(role) },
    { id: "billing", label: "Billing", icon: Landmark, show: canSeeStatement(role) },
    { id: "people", label: "People", icon: Users, show: canManageMembers(role) },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="portal">
      <header className="border-b bg-card">
        <div className="flex items-center gap-3 px-4 md:px-6 h-14">
          <Link href="/" onClick={forgetBusinessHome} className="text-muted-foreground hover:text-foreground" title="Back to the app" data-testid="link-portal-back"><ArrowLeft className="h-5 w-5" /></Link>
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
            {canBook(role) && parcels && (
              <Button size="sm" variant="outline" onClick={() => setSendingParcel(true)} disabled={org.status !== "active"} data-testid="button-portal-send-parcel" title="Send a parcel (P)" aria-label="Send a parcel">
                <Package className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Send a parcel</span>
              </Button>
            )}
            {canBook(role) && (
              <Button size="sm" onClick={() => setBooking(true)} disabled={org.status !== "active"} data-testid="button-portal-book" title="Book a ride (N)" aria-label="Book a ride">
                <Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Book a ride</span>
              </Button>
            )}
            <span className="text-xs text-muted-foreground hidden md:inline">{user?.firstName}</span>
            <Button size="sm" variant="ghost" asChild data-testid="button-portal-to-rider" title="Switch to the rider app" aria-label="Switch to the rider app">
              <Link href="/" onClick={forgetBusinessHome}><Car className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Rider app</span></Link>
            </Button>
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
          {view === "jobs" && <JobsList org={org} canCancel={canBook(role)} onSendAgain={parcels && canBook(role) ? sendAgain : undefined} />}
          {view === "recipients" && parcels && canBook(role) && <RecipientsView org={org} onSend={sendAgain} />}
          {view === "standing" && <StandingOrdersView orgId={org.id} canBook={canBook(role)} parcels={parcels} />}
          {view === "statement" && canSeeStatement(role) && <StatementView org={org} />}
          {view === "billing" && canSeeStatement(role) && <BillingView orgId={org.id} />}
          {view === "people" && canManageMembers(role) && <PeopleView org={org} />}
        </main>
      </div>

      {booking && <BookJobDrawer org={org} onClose={() => setBooking(false)} />}
      {sendingParcel && parcels && <BookDeliveryDrawer orgId={org.id} orgName={org.name} askRecipientByDefault={org.askRecipientByDefault} orgAddress={org.address} prefill={parcelPrefill} onClose={() => { setSendingParcel(false); setParcelPrefill(null); }} />}
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
        {mayBook && <Button variant="outline" size="sm" onClick={onBook} data-testid="button-portal-book-inline"><Plus className="h-4 w-4 mr-1" /> Book a ride</Button>}
      </div>
      <div className="grid grid-cols-1 2xl:grid-cols-[1fr_380px] gap-4">
        <div className="rounded-lg border bg-card overflow-x-auto">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : upcoming.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="text-portal-no-jobs">Nothing booked for the next two days.{mayBook ? " Press N to book a ride." : ""}</p>
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

function JobsList({ org, canCancel, onSendAgain }: { org: Org; canCancel: boolean; onSendAgain?: (pre: DeliveryPrefill) => void }) {
  const { toast } = useToast();
  const [rangeId, setRangeId] = useState("next7");
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const [window_] = useState(() => ({ from: range.from(), to: range.to() }));
  const bounds = useMemo(() => ({ from: range.from(), to: range.to() }), [rangeId]);
  void window_;
  const { data: jobs = [], isLoading } = useJobs(org.id, bounds.from, bounds.to);
  const sendAnyway = useMutation({
    mutationFn: (jobId: string) => json("POST", `/api/org/${org.id}/jobs/${jobId}/send-anyway`),
    onSuccess: () => { invalidateJobs(org.id); toast({ title: "Sent", description: "The job is now open to drivers." }); },
    onError: (e: Error) => toast({ title: "Could not send it", description: e.message, variant: "destructive" }),
  });
  const resendLink = useMutation({
    mutationFn: (jobId: string) => json<{ textSent: boolean; link: string }>("POST", `/api/org/${org.id}/jobs/${jobId}/resend-approval-link`),
    onSuccess: (r) => toast({ title: r.textSent ? "Text sent again" : "Texts are not set up", description: r.textSent ? "The recipient has the link again." : r.link }),
    onError: (e: Error) => toast({ title: "Could not resend it", description: e.message, variant: "destructive" }),
  });
  const copyApprovalLink = async (token: string) => {
    const link = `${window.location.origin}/approve/${token}`;
    try { await navigator.clipboard.writeText(link); toast({ title: "Approval link copied", description: "Paste it into a text or WhatsApp to the recipient." }); }
    catch { toast({ title: "Copy this link", description: link }); }
  };
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
                  <td className="px-3 py-2"><Badge variant={tone[j.status] ?? "outline"} className="whitespace-nowrap">{STATUS_WORDS[j.status] ?? j.status}</Badge>{describeApproval(j) ? <div className={`text-xs mt-1 ${j.recipientApproval === "approved" ? "text-green-700" : "text-amber-700"}`} data-testid={`text-portal-approval-${j.id}`}>{describeApproval(j)}</div> : null}</td>
                  <td className="px-3 py-2">{j.driverName ?? "—"}{describeProof(j.proof, j.handover) ? <div className={`text-xs ${j.proof?.farFromDrop ? "text-amber-700" : "text-muted-foreground"}`} data-testid={`text-portal-proof-${j.id}`}>{describeProof(j.proof, j.handover)}{j.proof?.photoUrl && !j.proof?.photoRetired ? <> · <a href={j.proof.photoUrl} target="_blank" rel="noreferrer" className="underline" data-testid={`link-portal-proof-photo-${j.id}`}>see photo</a></> : null}</div> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(j.total)}</td>
                  <td className="px-3 py-2 text-right">
                    {onSendAgain && j.parcel && (
                      <Button variant="ghost" size="sm" onClick={() => onSendAgain({ parcelSize: j.parcel!.parcelSize, handover: j.parcel!.handover, askRecipient: j.recipientApproval !== "none" && j.recipientApproval !== undefined, pickupContact: j.parcel!.pickupContact, dropContact: j.parcel!.dropContact, pickup: j.pickup, destination: j.destination })} data-testid={`button-portal-send-again-${j.id}`}>Send again</Button>
                    )}
                    {canCancel && (j.recipientApproval === "awaiting" || j.recipientApproval === "declined") && j.status === "pending" && (
                      <span className="inline-flex flex-wrap gap-1">
                        {j.recipientApprovalToken && <Button variant="ghost" size="sm" onClick={() => copyApprovalLink(j.recipientApprovalToken!)} data-testid={`button-portal-copy-approval-link-${j.id}`}>Copy link</Button>}
                        <Button variant="ghost" size="sm" onClick={() => resendLink.mutate(j.id)} data-testid={`button-portal-resend-approval-link-${j.id}`}>Text again</Button>
                        <Button variant="outline" size="sm" onClick={() => { if (window.confirm(`Send ${formatJobNumber(j.jobNumber)} without waiting for the recipient's approval? It goes to drivers at once.`)) sendAnyway.mutate(j.id); }} data-testid={`button-portal-send-anyway-${j.id}`}>Send anyway</Button>
                      </span>
                    )}
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

interface SavedRecipientRow { id: string; name: string; phone: string | null; address: { lat: number; lng: number; address: string }; handover: string; note: string | null }

function RecipientsView({ org, onSend }: { org: Org; onSend: (pre: DeliveryPrefill) => void }) {
  const { toast } = useToast();
  const { data: recipients = [], isLoading } = useQuery<SavedRecipientRow[]>({ queryKey: ["/api/org", org.id, "recipients"], queryFn: () => json("GET", `/api/org/${org.id}/recipients`) });
  const remove = useMutation({
    mutationFn: (id: string) => json("DELETE", `/api/org/${org.id}/recipients/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/org", org.id, "recipients"] }); toast({ title: "Recipient removed", description: "Past deliveries keep their details." }); },
    onError: (e: Error) => toast({ title: "Could not remove them", description: e.message, variant: "destructive" }),
  });
  return (
    <section className="space-y-4 max-w-3xl" data-testid="portal-recipients">
      <div><h1 className="text-xl font-semibold">Recipients</h1><p className="text-sm text-muted-foreground">The people you send to again and again. Tick "Remember this recipient" when you book a parcel and they appear here; pick them from the parcel form next time, or press Send.</p></div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : recipients.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="portal-recipients-empty">Nobody saved yet.</p> : (
        <ul className="rounded-lg border bg-card divide-y text-sm">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`row-portal-recipient-${r.id}`}>
              <span className="min-w-0"><span className="font-medium">{r.name}</span>{r.phone ? <span className="text-muted-foreground"> · {r.phone}</span> : null}<div className="truncate text-muted-foreground">{r.address.address}{r.note ? ` · ${r.note}` : ""}</div></span>
              <span className="flex items-center gap-1 shrink-0">
                <Button size="sm" onClick={() => onSend({ dropContact: { name: r.name, phone: r.phone, note: r.note }, destination: r.address, handover: r.handover })} disabled={org.status !== "active"} data-testid={`button-portal-send-to-recipient-${r.id}`}>Send</Button>
                <Button variant="ghost" size="sm" onClick={() => { if (window.confirm(`Remove ${r.name} from the book? Past deliveries keep their details.`)) remove.mutate(r.id); }} data-testid={`button-portal-remove-recipient-${r.id}`}>Remove</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
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

interface Invitation { id: string; email: string; role: OrgRole; expiresAt: string; createdAt: string }
interface InvitedResponse { invited: true; email: string; role: OrgRole; link: string; emailSent: boolean; expiresAt: string }

function PeopleView({ org }: { org: Org }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: members = [] } = useQuery<Member[]>({ queryKey: ["/api/org", org.id, "members"], queryFn: () => json("GET", `/api/org/${org.id}/members`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("requester");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/org", org.id, "members"] });
  const { data: invitations = [] } = useQuery<Invitation[]>({ queryKey: ["/api/org", org.id, "invitations"], queryFn: () => json("GET", `/api/org/${org.id}/invitations`) });
  const refreshInvites = () => queryClient.invalidateQueries({ queryKey: ["/api/org", org.id, "invitations"] });
  const [lastLink, setLastLink] = useState<{ email: string; link: string; emailSent: boolean } | null>(null);
  const add = useMutation({
    mutationFn: () => json<Member | InvitedResponse>("POST", `/api/org/${org.id}/members`, { email, role }),
    onSuccess: (m) => {
      setEmail("");
      if ("invited" in m && m.invited) {
        refreshInvites();
        setLastLink({ email: m.email, link: m.link, emailSent: m.emailSent });
        toast({ title: m.emailSent ? "Invitation sent" : "Invitation ready", description: m.emailSent ? `${m.email} has an email with a link to join ${org.name}.` : `Send ${m.email} the link shown below to join ${org.name}.` });
        return;
      }
      const member = m as Member;
      refresh();
      toast({ title: "Person added", description: `${member.firstName ?? ""} ${member.lastName ?? ""} is now ${member.role} for ${org.name}.` });
    },
    onError: (e: Error) => toast({ title: "Could not add them", description: e.message, variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => json("DELETE", `/api/org/${org.id}/invitations/${id}`),
    onSuccess: () => { refreshInvites(); setLastLink(null); toast({ title: "Invitation revoked" }); },
    onError: (e: Error) => toast({ title: "Could not revoke it", description: e.message, variant: "destructive" }),
  });
  const copyLink = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast({ title: "Link copied", description: "Paste it into a text or email to them." }); }
    catch { toast({ title: "Copy it from the box below", description: link }); }
  };
  const remove = useMutation({
    mutationFn: (userId: string) => json("DELETE", `/api/org/${org.id}/members/${userId}`),
    onSuccess: () => { refresh(); toast({ title: "Person removed" }); },
    onError: (e: Error) => toast({ title: "Could not remove them", description: e.message, variant: "destructive" }),
  });
  return (
    <section className="space-y-4 max-w-3xl" data-testid="portal-people">
      <div><h1 className="text-xl font-semibold">People</h1><p className="text-sm text-muted-foreground">Owners do everything. Requesters book. Billing sees statements. Enter their email: someone with a {BRAND.appName} account is added at once; anyone else gets an invitation link to set up their sign-in and land straight in this desk.</p></div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input placeholder="Their email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) add.mutate(); }} data-testid="input-portal-member-email" />
        <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
          <SelectTrigger className="sm:w-40" data-testid="select-portal-member-role"><SelectValue /></SelectTrigger>
          <SelectContent>{ORG_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <Button disabled={!email.trim() || add.isPending} onClick={() => add.mutate()} data-testid="button-portal-add-member">Add</Button>
      </div>
      {lastLink && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2" data-testid="portal-invite-link">
          <p>{lastLink.emailSent ? `Emailed to ${lastLink.email}. You can also send them this link yourself:` : `Email is not set up on this server, so send ${lastLink.email} this link yourself:`}</p>
          <Input readOnly value={lastLink.link} onFocus={(e) => e.currentTarget.select()} data-testid="input-portal-invite-link" />
        </div>
      )}
      {invitations.length > 0 && (
        <div className="space-y-2" data-testid="portal-invitations">
          <h2 className="text-sm font-medium text-muted-foreground">Invited, not yet joined</h2>
          <ul className="rounded-lg border bg-card divide-y text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`row-portal-invitation-${i.id}`}>
                <span><span className="font-medium">{i.email}</span> <span className="text-muted-foreground">expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{i.role}</Badge>
                  {lastLink?.email === i.email && <Button variant="ghost" size="sm" onClick={() => copyLink(lastLink.link)} data-testid={`button-portal-copy-invite-${i.id}`}>Copy link</Button>}
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)} data-testid={`button-portal-revoke-invite-${i.id}`}>Revoke</Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="Book a ride" data-testid="portal-book-drawer">
      <div className="w-full sm:w-[480px] h-full bg-background shadow-xl overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Book a ride for {org.name}</h2><Button variant="ghost" size="sm" onClick={onClose} data-testid="button-portal-close-book">Close</Button></div>
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
