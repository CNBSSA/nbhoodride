/**
 * Standing orders — the desk's recurring instructions: "Monday, Wednesday,
 * Friday at 6:10 AM, return at 10:30" or "return when the patient is
 * ready". Jobs are booked from them a week ahead; the board shows the jobs.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { PLAN_DAY_LABELS, describePlanDays, describePlanTime } from "@shared/weeklyPlan";
import { RETURN_MODES, type ReturnMode } from "@shared/commercialTerms";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { Plus } from "lucide-react";

interface StandingOrder {
  id: string; passengerName: string; passengerPhone: string | null; pickup: { address: string }; destination: { address: string };
  days: number[]; departureHour: number; departureMinute: number; returnMode: ReturnMode; returnHour: number | null; returnMinute: number | null;
  vehicleType: string; notes: string | null; poNumber: string | null; isActive: boolean; jobCount?: number;
}

const RETURN_WORDS: Record<ReturnMode, string> = { none: "No return", fixed: "Return at a fixed time", will_call: "Return when the passenger is ready (will-call)" };

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function StandingOrdersView({ orgId, canBook }: { orgId: string; canBook: boolean }) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const { data: orders = [], isLoading } = useQuery<StandingOrder[]>({ queryKey: ["/api/org", orgId, "standing-orders"], queryFn: () => json("GET", `/api/org/${orgId}/standing-orders`) });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "standing-orders"] }); queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "jobs"] }); };
  const toggle = useMutation({
    mutationFn: (o: StandingOrder) => json("POST", `/api/org/${orgId}/standing-orders/${o.id}/${o.isActive ? "pause" : "resume"}`),
    onSuccess: (_r, o) => { refresh(); toast({ title: o.isActive ? "Standing order paused" : "Standing order resumed", description: o.isActive ? "Jobs already booked stay booked; cancel any you do not want." : "Its next jobs will be booked within a few minutes." }); },
    onError: (e: Error) => toast({ title: "Could not change it", description: e.message, variant: "destructive" }),
  });
  return (
    <section className="space-y-4" data-testid="portal-standing-orders">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Standing orders</h1>
          <p className="text-sm text-muted-foreground">Rides that repeat. Jobs are booked from them a week ahead and appear on the board like any other.</p>
        </div>
        {canBook && <Button size="sm" onClick={() => setCreating(true)} data-testid="button-portal-new-standing-order"><Plus className="h-4 w-4 mr-1" /> New standing order</Button>}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : orders.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground" data-testid="text-portal-no-standing-orders">No standing orders yet.</p>
      ) : (
        <ul className="rounded-lg border bg-card divide-y">
          {orders.map((o) => (
            <li key={o.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3" data-testid={`row-portal-standing-order-${o.id}`}>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{o.passengerName} <Badge variant={o.isActive ? "default" : "secondary"} className="ml-2">{o.isActive ? "active" : "paused"}</Badge></div>
                <div className="text-sm">{describePlanDays(o.days)} at {describePlanTime(o.departureHour, o.departureMinute)}{o.returnMode === "fixed" && o.returnHour != null ? `, return ${describePlanTime(o.returnHour, o.returnMinute ?? 0)}` : o.returnMode === "will_call" ? ", return when ready" : ""}</div>
                <div className="text-sm text-muted-foreground truncate">{o.pickup?.address} to {o.destination?.address}</div>
                <div className="text-xs text-muted-foreground">{VEHICLE_TYPE_LABELS[o.vehicleType as keyof typeof VEHICLE_TYPE_LABELS] ?? o.vehicleType}{o.poNumber ? ` · ${o.poNumber}` : ""}{o.jobCount ? ` · ${o.jobCount} jobs booked so far` : ""}</div>
              </div>
              {canBook && <Button variant="outline" size="sm" onClick={() => toggle.mutate(o)} disabled={toggle.isPending} data-testid={`button-portal-toggle-standing-order-${o.id}`}>{o.isActive ? "Pause" : "Resume"}</Button>}
            </li>
          ))}
        </ul>
      )}
      {creating && <NewStandingOrder orgId={orgId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} />}
    </section>
  );
}

function NewStandingOrder({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [passengerName, setPassengerName] = useState("");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [pickup, setPickup] = useState<AddressSuggestion | null>(null);
  const [destText, setDestText] = useState("");
  const [dest, setDest] = useState<AddressSuggestion | null>(null);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState("06:10");
  const [returnMode, setReturnMode] = useState<ReturnMode>("fixed");
  const [returnTime, setReturnTime] = useState("10:30");
  const [vehicleType, setVehicleType] = useState("standard");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const ready = !!(passengerName.trim() && pickup && dest && days.length && time && (returnMode !== "fixed" || returnTime));
  const create = useMutation({
    mutationFn: () => {
      const [h, m] = time.split(":").map(Number);
      const [rh, rm] = (returnTime || "0:0").split(":").map(Number);
      return json<StandingOrder & { booked: number }>("POST", `/api/org/${orgId}/standing-orders`, {
        passengerName, passengerPhone, pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label }, destination: { lat: dest!.lat, lng: dest!.lng, address: dest!.label },
        days, departureHour: h, departureMinute: m, returnMode, returnHour: returnMode === "fixed" ? rh : null, returnMinute: returnMode === "fixed" ? rm : null, vehicleType, poNumber, notes,
      });
    },
    onSuccess: (r) => { toast({ title: "Standing order created", description: `${r.booked} job${r.booked === 1 ? "" : "s"} booked for the week ahead.` }); onCreated(); },
    onError: (e: Error) => toast({ title: "Could not create it", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="New standing order" data-testid="portal-standing-order-drawer">
      <div className="w-full sm:w-[520px] h-full bg-background shadow-xl overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready) { e.preventDefault(); create.mutate(); } }}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">New standing order</h2><Button variant="ghost" size="sm" onClick={onClose} data-testid="button-portal-close-standing-order">Close</Button></div>
        <Input autoFocus placeholder="Passenger name" value={passengerName} onChange={(e) => setPassengerName(e.target.value)} data-testid="input-portal-so-passenger" />
        <Input placeholder="Passenger phone (optional)" value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} data-testid="input-portal-so-phone" />
        <AddressAutocomplete value={pickupText} onChange={(v) => { setPickupText(v); setPickup(null); }} onSelect={(s) => { setPickup(s); setPickupText(s.label); }} placeholder="Pickup address" data-testid="input-portal-so-pickup" />
        <AddressAutocomplete value={destText} onChange={(v) => { setDestText(v); setDest(null); }} onSelect={(s) => { setDest(s); setDestText(s.label); }} placeholder="Destination address" data-testid="input-portal-so-destination" />
        <div>
          <div className="text-xs text-muted-foreground mb-1">Days</div>
          <div className="flex flex-wrap gap-1">
            {PLAN_DAY_LABELS.map((label, i) => (
              <Button key={label} type="button" size="sm" variant={days.includes(i) ? "default" : "outline"} onClick={() => setDays((d) => d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort())} data-testid={`chip-portal-so-day-${i}`}>{label}</Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Pickup time<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1" data-testid="input-portal-so-time" /></label>
          <label className="text-xs text-muted-foreground">Vehicle
            <Select value={vehicleType} onValueChange={setVehicleType}><SelectTrigger className="mt-1" data-testid="select-portal-so-vehicle"><SelectValue /></SelectTrigger><SelectContent>{VEHICLE_TYPES.map((v) => <SelectItem key={v} value={v}>{VEHICLE_TYPE_LABELS[v]}</SelectItem>)}</SelectContent></Select>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Return
            <Select value={returnMode} onValueChange={(v) => setReturnMode(v as ReturnMode)}><SelectTrigger className="mt-1" data-testid="select-portal-so-return"><SelectValue /></SelectTrigger><SelectContent>{RETURN_MODES.map((r) => <SelectItem key={r} value={r}>{RETURN_WORDS[r]}</SelectItem>)}</SelectContent></Select>
          </label>
          {returnMode === "fixed" && <label className="text-xs text-muted-foreground">Return time<Input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className="mt-1" data-testid="input-portal-so-return-time" /></label>}
        </div>
        <Input placeholder="PO / reference (optional)" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} data-testid="input-portal-so-po" />
        <Textarea placeholder="Notes for the driver" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-portal-so-notes" />
        <Button className="w-full" disabled={!ready || create.isPending} onClick={() => create.mutate()} data-testid="button-portal-submit-standing-order">{create.isPending ? "Creating…" : "Create standing order"}</Button>
      </div>
    </div>
  );
}
