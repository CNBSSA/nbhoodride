/**
 * The fleet desk (PG Ride Fleet Management Accounts Plan, slice 1).
 *
 * A fleet account opens here from the same business door and the same /org
 * portal as a booking account, but it never books: the desk shows where the
 * application stands, the business on file, how the fleet is paid, and the
 * split it works on, its cars (slice 2) and its drivers and who has which
 * car (slice 3). Earnings (slice 4) arrive later. Everything comes from /api/fleet/*, which answers
 * only for fleets the signed-in person belongs to.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Car, Landmark, ShieldCheck, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forgetBusinessHome } from "@/lib/businessHome";
import { BRAND } from "@shared/branding";
import { BUSINESS_TYPE_LABELS, FLEET_LABEL, FLEET_PAYOUT_METHODS, type BusinessType } from "@shared/fleet";
import { FleetCarsSection } from "@/components/portal/FleetCars";
import { FleetDriversSection } from "@/components/portal/FleetDrivers";

interface Desk {
  id: string; name: string; status: "pending" | "active" | "paused" | "rejected"; statusText: string; reviewNote: string | null; role: string;
  business: { legalName: string; businessType: string; ein: string }; contactPhone: string | null;
  payout: { payoutMethod?: string | null; payoutDetails?: string | null; onFile?: boolean };
  counts: { cars: number; carsReady: number; drivers: number }; people: Array<{ userId: string; role: string; name: string | null }>; terms: string;
}

const STATUS_TONE: Record<Desk["status"], "default" | "secondary" | "destructive" | "outline"> = { pending: "outline", active: "default", paused: "secondary", rejected: "destructive" };

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function FleetDesk({ orgId, memberships, onSwitch }: { orgId: string; memberships: Array<{ organization: { id: string; name: string } }>; onSwitch: (id: string) => void }) {
  const { data: desk, error, isLoading } = useQuery<Desk>({ queryKey: ["/api/fleet", orgId], queryFn: () => json("GET", `/api/fleet/${orgId}`) });
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="fleet-desk">
      <header className="border-b bg-card">
        <div className="flex items-center gap-3 px-4 md:px-6 h-14">
          <Link href="/" onClick={forgetBusinessHome} className="text-muted-foreground hover:text-foreground" title="Back to the app" data-testid="link-fleet-back"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="font-semibold truncate">{BRAND.appName}</div>
          <span className="text-muted-foreground hidden sm:inline">·</span>
          {memberships.length > 1 ? (
            <Select value={orgId} onValueChange={onSwitch}>
              <SelectTrigger className="w-64 h-9" data-testid="select-fleet-org"><SelectValue /></SelectTrigger>
              <SelectContent>{memberships.map((m) => <SelectItem key={m.organization.id} value={m.organization.id}>{m.organization.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : <div className="truncate" data-testid="text-fleet-name">{desk?.name ?? ""}</div>}
          {desk && <Badge variant={STATUS_TONE[desk.status] ?? "outline"} data-testid="badge-fleet-status">{desk.status === "active" ? "approved" : desk.status}</Badge>}
          <div className="ml-auto">
            <Button size="sm" variant="ghost" asChild data-testid="button-fleet-to-rider" title="Switch to the rider app" aria-label="Switch to the rider app">
              <Link href="/" onClick={forgetBusinessHome}><Car className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Rider app</span></Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading your fleet…</p>}
        {error && <p className="text-sm text-destructive" data-testid="text-fleet-error">{(error as Error).message}</p>}
        {desk && (
          <>
            <section className="border rounded-xl p-4 space-y-2" data-testid="fleet-status">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{FLEET_LABEL}</p>
              <p className="font-medium" data-testid="text-fleet-status">{desk.statusText}</p>
              {desk.reviewNote && <p className="text-sm text-destructive" data-testid="text-fleet-review-note">PG Ride's note: {desk.reviewNote}</p>}
              {desk.status === "pending" && !desk.payout.payoutMethod && !desk.payout.onFile && <p className="text-sm text-muted-foreground">PG Ride approves a fleet once it has said how it is paid, below.</p>}
              {desk.status === "rejected" && desk.role === "owner" && <Resubmit desk={desk} />}
            </section>

            <section className="border rounded-xl p-4 space-y-1" data-testid="fleet-business">
              <p className="font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> The business</p>
              <p className="text-sm">{desk.business.legalName} · {BUSINESS_TYPE_LABELS[desk.business.businessType as BusinessType] ?? desk.business.businessType} · EIN {desk.business.ein}</p>
              {desk.contactPhone && <p className="text-xs text-muted-foreground">PG Ride calls {desk.contactPhone}</p>}
            </section>

            <section className="border rounded-xl p-4 space-y-2" data-testid="fleet-payout">
              <p className="font-medium flex items-center gap-2"><Landmark className="h-4 w-4" /> How the fleet is paid</p>
              {desk.role === "owner" ? <PayoutForm desk={desk} /> : <p className="text-sm text-muted-foreground">{desk.payout.onFile ? "A payout method is on file. The owner manages it." : "The owner has not added a payout method yet."}</p>}
            </section>

            <section className="border rounded-xl p-4 space-y-2" data-testid="fleet-cars-drivers">
              <p className="font-medium flex items-center gap-2"><Car className="h-4 w-4" /> Cars and drivers</p>
              <p className="text-sm text-muted-foreground">{desk.counts.cars} cars, {desk.counts.carsReady} ready · {desk.counts.drivers} drivers. {desk.status === "active" ? "Give each ready car to one of your approved drivers." : "Once PG Ride approves the fleet, you add cars and invite drivers here."}</p>
              {desk.status === "active" && <FleetCarsSection orgId={desk.id} canManage={desk.role === "owner" || desk.role === "manager"} />}
              {desk.status === "active" && <FleetDriversSection orgId={desk.id} canManage={desk.role === "owner" || desk.role === "manager"} />}
            </section>

            <section className="border rounded-xl p-4 space-y-1" data-testid="fleet-people">
              <p className="font-medium flex items-center gap-2"><Users className="h-4 w-4" /> People</p>
              {desk.people.map((p) => <p key={p.userId} className="text-sm">{p.name ?? "—"} · {p.role}</p>)}
            </section>

            <p className="text-xs text-muted-foreground" data-testid="text-fleet-terms">{desk.terms}</p>
          </>
        )}
      </main>
    </div>
  );
}

function PayoutForm({ desk }: { desk: Desk }) {
  const { toast } = useToast();
  const [method, setMethod] = useState(desk.payout.payoutMethod ?? "zelle");
  const [details, setDetails] = useState(desk.payout.payoutDetails ?? "");
  const save = useMutation({
    mutationFn: () => json("PUT", `/api/fleet/${desk.id}/payout`, { payoutMethod: method, payoutDetails: details }),
    onSuccess: () => { toast({ title: "Payout method saved", description: "PG Ride pays the fleet every Friday to this account." }); queryClient.invalidateQueries({ queryKey: ["/api/fleet", desk.id] }); },
    onError: (e: Error) => toast({ title: "Could not save it", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">It has to be an account in the business's own name.</p>
      <div className="flex flex-wrap gap-2">
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-36 h-9" data-testid="select-fleet-payout-method"><SelectValue /></SelectTrigger>
          <SelectContent>{FLEET_PAYOUT_METHODS.map((m) => <SelectItem key={m} value={m}>{m === "cashapp" ? "Cash App" : m === "paypal" ? "PayPal" : m[0].toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="h-9 flex-1 min-w-[12rem]" placeholder={method === "check" ? "The business's mailing address" : "The business's email, phone or handle"} value={details} onChange={(e) => setDetails(e.target.value)} data-testid="input-fleet-payout-details" />
        <Button size="sm" disabled={save.isPending || details.trim().length < 3} onClick={() => save.mutate()} data-testid="button-fleet-save-payout">{desk.payout.payoutMethod ? "Update" : "Save"}</Button>
      </div>
    </div>
  );
}

function Resubmit({ desk }: { desk: Desk }) {
  const { toast } = useToast();
  const [legalName, setLegalName] = useState(desk.business.legalName);
  const [ein, setEin] = useState("");
  const send = useMutation({
    mutationFn: () => json("PATCH", `/api/fleet/${desk.id}/application`, { legalName, ...(ein ? { ein } : {}) }),
    onSuccess: () => { toast({ title: "Sent to PG Ride again", description: "You'll see here when it is checked." }); queryClient.invalidateQueries({ queryKey: ["/api/fleet", desk.id] }); },
    onError: (e: Error) => toast({ title: "Could not send it", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-2 pt-1" data-testid="form-fleet-resubmit">
      <Input className="h-9" placeholder="Legal name, as registered" value={legalName} onChange={(e) => setLegalName(e.target.value)} data-testid="input-fleet-resubmit-legal-name" />
      <Input className="h-9" placeholder={`EIN (on file: ${desk.business.ein}); leave blank to keep it`} value={ein} onChange={(e) => setEin(e.target.value)} data-testid="input-fleet-resubmit-ein" />
      <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()} data-testid="button-fleet-resubmit">Correct and send again</Button>
    </div>
  );
}
