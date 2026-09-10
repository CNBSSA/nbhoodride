/**
 * Booking a delivery from the desk — a job with no passenger.
 *
 * The same drawer shape as booking a ride, with what a parcel needs
 * instead of who is riding: what is being sent, who hands it over, who
 * receives it, and the window it must land in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { DEFAULT_WINDOW_HOURS, PARCEL_LABELS, PARCEL_NOTES, PARCEL_SIZES, describeDeliveryTariff, type ParcelSize } from "@shared/deliveries";

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}
const money = (n: string | number) => `$${Number(n ?? 0).toFixed(2)}`;

export function BookDeliveryDrawer({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  const { toast } = useToast();
  const first = useRef<HTMLInputElement>(null);
  const [parcelSize, setParcelSize] = useState<ParcelSize>("small");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [dropName, setDropName] = useState("");
  const [dropPhone, setDropPhone] = useState("");
  const [dropNote, setDropNote] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [pickup, setPickup] = useState<AddressSuggestion | null>(null);
  const [destText, setDestText] = useState("");
  const [dest, setDest] = useState<AddressSuggestion | null>(null);
  const [readyAt, setReadyAt] = useState("");
  const [windowHours, setWindowHours] = useState("2");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { first.current?.focus(); }, []);

  const ready = !!(pickupName.trim() && dropName.trim() && pickup && dest && readyAt);
  const book = useMutation({
    mutationFn: () => json<{ job: { jobLabel: string }; ride: { estimatedFare: string } }>("POST", `/api/org/${orgId}/deliveries`, {
      parcelSize,
      pickupContact: { name: pickupName, phone: pickupPhone },
      dropContact: { name: dropName, phone: dropPhone, note: dropNote },
      pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label },
      destination: { lat: dest!.lat, lng: dest!.lng, address: dest!.label },
      readyAt: new Date(readyAt).toISOString(),
      windowHours: Number(windowHours) || DEFAULT_WINDOW_HOURS,
      poNumber, notes,
    }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "jobs"] });
      toast({ title: `Booked ${r.job.jobLabel}`, description: `${money(r.ride.estimatedFare)}, billed to ${orgName}.` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Could not book it", description: e.message, variant: "destructive" }),
  });
  const submit = useCallback(() => { if (ready && !book.isPending) book.mutate(); }, [ready, book]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="Book a delivery" data-testid="portal-delivery-drawer">
      <div className="w-full sm:w-[480px] h-full bg-background shadow-xl overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Send a parcel for {orgName}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-portal-close-delivery">Close</Button>
        </div>
        <p className="text-xs text-muted-foreground">{describeDeliveryTariff()} Booked at least 45 minutes ahead; Ctrl+Enter books.</p>

        <label className="block text-xs text-muted-foreground">What is being sent
          <Select value={parcelSize} onValueChange={(v) => setParcelSize(v as ParcelSize)}>
            <SelectTrigger className="mt-1" data-testid="select-portal-parcel-size"><SelectValue /></SelectTrigger>
            <SelectContent>{PARCEL_SIZES.map((s) => <SelectItem key={s} value={s}>{PARCEL_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <p className="text-xs text-muted-foreground -mt-1">{PARCEL_NOTES[parcelSize]}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input ref={first} placeholder="Who hands it over" value={pickupName} onChange={(e) => setPickupName(e.target.value)} data-testid="input-portal-pickup-contact" />
          <Input placeholder="Their phone (optional)" value={pickupPhone} onChange={(e) => setPickupPhone(e.target.value)} data-testid="input-portal-pickup-phone" />
        </div>
        <AddressAutocomplete value={pickupText} onChange={(v) => { setPickupText(v); setPickup(null); }} onSelect={(s) => { setPickup(s); setPickupText(s.label); }} placeholder="Collect from" data-testid="input-portal-delivery-pickup" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input placeholder="Who receives it" value={dropName} onChange={(e) => setDropName(e.target.value)} data-testid="input-portal-drop-contact" />
          <Input placeholder="Their phone (optional)" value={dropPhone} onChange={(e) => setDropPhone(e.target.value)} data-testid="input-portal-drop-phone" />
        </div>
        <AddressAutocomplete value={destText} onChange={(v) => { setDestText(v); setDest(null); }} onSelect={(s) => { setDest(s); setDestText(s.label); }} placeholder="Deliver to" data-testid="input-portal-delivery-destination" />
        <Input placeholder="Where to find them: suite, floor, ask at reception…" value={dropNote} onChange={(e) => setDropNote(e.target.value)} data-testid="input-portal-drop-note" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Ready at
            <Input type="datetime-local" value={readyAt} onChange={(e) => setReadyAt(e.target.value)} className="mt-1" data-testid="input-portal-ready-at" />
          </label>
          <label className="text-xs text-muted-foreground">Deliver within
            <Select value={windowHours} onValueChange={setWindowHours}>
              <SelectTrigger className="mt-1" data-testid="select-portal-window-hours"><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 6, 8].map((h) => <SelectItem key={h} value={String(h)}>{h} hour{h === 1 ? "" : "s"}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <Input placeholder="PO / reference (optional)" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} data-testid="input-portal-delivery-po" />
        <Textarea placeholder="Anything else the driver needs" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-portal-delivery-notes" />
        <Button className="w-full" disabled={!ready || book.isPending} onClick={submit} data-testid="button-portal-submit-delivery">
          {book.isPending ? "Booking…" : "Book delivery"}
        </Button>
      </div>
    </div>
  );
}
