/**
 * Organizations — the operator's side of commercial riders (slice 1).
 *
 * Create an account, attach the people who may book for it, book a job on
 * its behalf, see its jobs, and pull a month's statement. The requester
 * portal (slice 2) gives the organization these screens itself; until then
 * this is how Phase 0 runs.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { CATEGORY_LABELS, COMMERCIAL_CATEGORIES, DEFAULT_FACILITY_FEE, ORG_ROLES, currentMonthKey, formatJobNumber, type CommercialCategory, type OrgRole } from "@shared/commercial";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";

interface OrgSummary {
  id: string; name: string; category: CommercialCategory; status: string; billingMode: string; facilityFee: string;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null; memberCount: number; jobCount: number;
}
interface Member { userId: string; role: OrgRole; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }
interface OrgDetail extends OrgSummary { members: Member[] }
interface JobRow {
  id: string; jobNumber: number; rideId: string; status: string; scheduledAt: string | null; createdAt: string;
  passengerName: string | null; pickup: { address: string }; destination: { address: string };
  estimatedFare: string | null; actualFare: string | null; facilityFee: string; driverName: string | null; total: number; vehicleType: string | null;
}
interface Statement { window: { label: string; monthKey: string }; lines: unknown[]; totals: { completed: number; cancelled: number; total: number } }

const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const eastern = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = { completed: "default", cancelled: "destructive", no_show: "destructive", pending: "outline", accepted: "secondary", driver_arriving: "secondary", in_progress: "secondary" };

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function OrganizationsPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: orgs = [], isLoading } = useQuery<OrgSummary[]>({ queryKey: ["/api/admin/organizations"] });
  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="space-y-6" data-testid="organizations-panel">
      <div>
        <h2 className="text-2xl font-bold">Organizations</h2>
        <p className="text-sm text-muted-foreground">Companies that book rides for other people and are billed for them. The business places every order.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4 lg:col-span-1">
          <CreateOrganizationCard onCreated={(id) => setSelectedId(id)} />
          <Card>
            <CardHeader><CardTitle className="text-base">Accounts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && orgs.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-organizations">No organizations yet. Create the first one above.</p>}
              {orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left rounded-lg border p-3 hover:bg-muted/60 ${o.id === selectedId ? "border-primary bg-muted/40" : ""}`}
                  data-testid={`button-open-organization-${o.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{o.name}</span>
                    <Badge variant={o.status === "active" ? "default" : "secondary"}>{o.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{CATEGORY_LABELS[o.category] ?? o.category} · {o.memberCount} people · {o.jobCount} jobs</div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selected ? <OrganizationDetail id={selected.id} /> : (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">Pick an account to see its people, book a job for it, or pull a statement.</CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateOrganizationCard({ onCreated }: { onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CommercialCategory>("medical");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [facilityFee, setFacilityFee] = useState<string>(String(DEFAULT_FACILITY_FEE.medical));
  const create = useMutation({
    mutationFn: () => json<OrgSummary>("POST", "/api/admin/organizations", { name, category, contactName, contactEmail, contactPhone, facilityFee: Number(facilityFee) }),
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      toast({ title: "Organization created", description: `${org.name} is ready for people and jobs.` });
      setName(""); setContactName(""); setContactEmail(""); setContactPhone("");
      onCreated(org.id);
    },
    onError: (e: Error) => toast({ title: "Could not create it", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New account</CardTitle>
        <CardDescription>A clinic, an office, a restaurant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-org-name" />
        <Select value={category} onValueChange={(v) => { setCategory(v as CommercialCategory); setFacilityFee(String(DEFAULT_FACILITY_FEE[v as CommercialCategory])); }}>
          <SelectTrigger data-testid="select-org-category"><SelectValue /></SelectTrigger>
          <SelectContent>{COMMERCIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} data-testid="input-org-contact-name" />
          <Input placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-testid="input-org-contact-phone" />
        </div>
        <Input placeholder="Contact email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} data-testid="input-org-contact-email" />
        <label className="block text-xs text-muted-foreground">Facility fee per completed job ($)
          <Input type="number" min={0} max={100} step="0.50" value={facilityFee} onChange={(e) => setFacilityFee(e.target.value)} data-testid="input-org-facility-fee" className="mt-1" />
        </label>
        <Button className="w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} data-testid="button-create-organization">
          {create.isPending ? "Creating…" : "Create account"}
        </Button>
      </CardContent>
    </Card>
  );
}

function OrganizationDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const { data: org } = useQuery<OrgDetail>({ queryKey: ["/api/admin/organizations", id], queryFn: () => json("GET", `/api/admin/organizations/${id}`) });
  const { data: jobs = [] } = useQuery<JobRow[]>({ queryKey: ["/api/admin/organizations", id, "jobs"], queryFn: () => json("GET", `/api/admin/organizations/${id}/jobs`) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations", id, "jobs"] });
  };
  const toggleStatus = useMutation({
    mutationFn: () => json("PATCH", `/api/admin/organizations/${id}`, { status: org?.status === "active" ? "paused" : "active" }),
    onSuccess: () => { refresh(); toast({ title: org?.status === "active" ? "Account paused" : "Account active" }); },
    onError: (e: Error) => toast({ title: "Could not change status", description: e.message, variant: "destructive" }),
  });
  if (!org) return <Card><CardContent className="pt-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;

  return (
    <div className="space-y-4" data-testid={`organization-detail-${org.id}`}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{org.name}</CardTitle>
            <CardDescription>{CATEGORY_LABELS[org.category] ?? org.category} · facility fee {money(org.facilityFee)} · billed {org.billingMode === "weekly_debit" ? "weekly" : "on terms"}{org.contactName ? ` · ${org.contactName}` : ""}{org.contactPhone ? ` · ${org.contactPhone}` : ""}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => toggleStatus.mutate()} disabled={toggleStatus.isPending} data-testid="button-toggle-organization-status">
            {org.status === "active" ? "Pause account" : "Activate account"}
          </Button>
        </CardHeader>
      </Card>

      <MembersCard org={org} onChanged={refresh} />
      <BookJobCard org={org} onBooked={refresh} />

      <Card>
        <CardHeader><CardTitle className="text-base">Jobs</CardTitle><CardDescription>Newest first. Totals are what the account is billed for each job in its current state.</CardDescription></CardHeader>
        <CardContent>
          {jobs.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-jobs">No jobs yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr><th className="text-left py-2 pr-3">Job</th><th className="text-left py-2 pr-3">When</th><th className="text-left py-2 pr-3">Passenger</th><th className="text-left py-2 pr-3">Trip</th><th className="text-left py-2 pr-3">Status</th><th className="text-left py-2 pr-3">Driver</th><th className="text-right py-2">Billed</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t" data-testid={`row-job-${j.id}`}>
                      <td className="py-2 pr-3 font-mono">{formatJobNumber(j.jobNumber)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{eastern(j.scheduledAt ?? j.createdAt)}</td>
                      <td className="py-2 pr-3">{j.passengerName}</td>
                      <td className="py-2 pr-3 max-w-[16rem]"><div className="truncate">{j.pickup?.address}</div><div className="truncate text-muted-foreground">to {j.destination?.address}</div></td>
                      <td className="py-2 pr-3"><Badge variant={statusTone[j.status] ?? "outline"}>{j.status.replace("_", " ")}</Badge></td>
                      <td className="py-2 pr-3">{j.driverName ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">{money(j.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <StatementCard org={org} />
    </div>
  );
}

function MembersCard({ org, onChanged }: { org: OrgDetail; onChanged: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("requester");
  const add = useMutation({
    mutationFn: () => json<Member>("POST", `/api/admin/organizations/${org.id}/members`, { email, role }),
    onSuccess: (m) => { setEmail(""); onChanged(); toast({ title: "Person added", description: `${m.firstName ?? ""} ${m.lastName ?? ""} can now ${m.role === "billing" ? "see statements" : "book"} for ${org.name}.` }); },
    onError: (e: Error) => toast({ title: "Could not add them", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => json("DELETE", `/api/admin/organizations/${org.id}/members/${userId}`),
    onSuccess: () => { onChanged(); toast({ title: "Person removed" }); },
    onError: (e: Error) => toast({ title: "Could not remove them", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">People</CardTitle><CardDescription>Owners do everything. Requesters book. Billing sees statements. They need a PG Ride account first.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Email of an existing PG Ride account" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-member-email" />
          <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
            <SelectTrigger className="sm:w-40" data-testid="select-member-role"><SelectValue /></SelectTrigger>
            <SelectContent>{ORG_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Button disabled={!email.trim() || add.isPending} onClick={() => add.mutate()} data-testid="button-add-member">Add</Button>
        </div>
        {org.members.length === 0 ? <p className="text-sm text-muted-foreground">Nobody yet. Until someone is added, jobs you book here belong to your own account.</p> : (
          <ul className="divide-y text-sm">
            {org.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between py-2 gap-2" data-testid={`row-member-${m.userId}`}>
                <span><span className="font-medium">{m.firstName} {m.lastName}</span> <span className="text-muted-foreground">{m.email}</span></span>
                <span className="flex items-center gap-2"><Badge variant="outline">{m.role}</Badge><Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)} data-testid={`button-remove-member-${m.userId}`}>Remove</Button></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BookJobCard({ org, onBooked }: { org: OrgDetail; onBooked: () => void }) {
  const { toast } = useToast();
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
  const ready = passengerName.trim() && pickup && dest && when;
  const book = useMutation({
    mutationFn: () => json<{ job: { jobLabel: string }; ride: { estimatedFare: string } }>("POST", `/api/admin/organizations/${org.id}/jobs`, {
      passengerName, passengerPhone,
      pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label },
      destination: { lat: dest!.lat, lng: dest!.lng, address: dest!.label },
      scheduledAt: new Date(when).toISOString(), vehicleType, poNumber, notes,
    }),
    onSuccess: (r) => {
      onBooked();
      toast({ title: `Booked ${r.job.jobLabel}`, description: `${money(r.ride.estimatedFare)} fare plus ${money(org.facilityFee)} facility fee, billed to ${org.name}.` });
      setPassengerName(""); setPassengerPhone(""); setPickupText(""); setPickup(null); setDestText(""); setDest(null); setWhen(""); setPoNumber(""); setNotes("");
    },
    onError: (e: Error) => toast({ title: "Could not book it", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Book a job for {org.name}</CardTitle><CardDescription>Booked at least 3 hours ahead. Drivers who cover the pickup county see it on their board.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input placeholder="Passenger name" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} data-testid="input-job-passenger-name" />
          <Input placeholder="Passenger phone (optional)" value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} data-testid="input-job-passenger-phone" />
        </div>
        <AddressAutocomplete value={pickupText} onChange={(v) => { setPickupText(v); setPickup(null); }} onSelect={(s) => { setPickup(s); setPickupText(s.label); }} placeholder="Pickup address" data-testid="input-job-pickup" />
        <AddressAutocomplete value={destText} onChange={(v) => { setDestText(v); setDest(null); }} onSelect={(s) => { setDest(s); setDestText(s.label); }} placeholder="Destination address" data-testid="input-job-destination" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="input-job-when" />
          <Select value={vehicleType} onValueChange={setVehicleType}>
            <SelectTrigger data-testid="select-job-vehicle"><SelectValue /></SelectTrigger>
            <SelectContent>{VEHICLE_TYPES.map((v) => <SelectItem key={v} value={v}>{VEHICLE_TYPE_LABELS[v]}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="PO / reference (optional)" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} data-testid="input-job-po" />
        </div>
        <Textarea placeholder="Notes for the driver: door, wheelchair folds, ask for the nurse…" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-job-notes" rows={2} />
        <Button className="w-full" disabled={!ready || book.isPending || org.status !== "active"} onClick={() => book.mutate()} data-testid="button-book-job">
          {org.status !== "active" ? "Account is paused" : book.isPending ? "Booking…" : "Book job"}
        </Button>
      </CardContent>
    </Card>
  );
}

function StatementCard({ org }: { org: OrgDetail }) {
  const [month, setMonth] = useState(currentMonthKey());
  const { data: statement } = useQuery<Statement>({ queryKey: ["/api/admin/organizations", org.id, "statement", month], queryFn: () => json("GET", `/api/admin/organizations/${org.id}/statement?month=${month}`) });
  const base = `/api/admin/organizations/${org.id}/statement?month=${month}`;
  const summary = useMemo(() => statement ? `${statement.totals.completed} completed, ${statement.totals.cancelled} cancelled, ${money(statement.totals.total)} for ${statement.window.label}` : "", [statement]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Statement</CardTitle><CardDescription>Completed jobs at fare plus facility fee; cancelled jobs at their cancellation fee.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="sm:w-44" data-testid="input-statement-month" />
          <span className="text-sm" data-testid="text-statement-summary">{summary}</span>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><a href={`${base}&format=csv`} data-testid="link-statement-csv">Download CSV</a></Button>
          <Button asChild variant="outline" size="sm"><a href={`${base}&format=html`} target="_blank" rel="noreferrer" data-testid="link-statement-print">Open printable</a></Button>
        </div>
      </CardContent>
    </Card>
  );
}
