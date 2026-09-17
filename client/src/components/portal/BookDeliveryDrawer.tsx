/**
 * Booking a delivery from the desk — a job with no passenger.
 *
 * The same drawer shape as booking a ride, with what a parcel needs
 * instead of who is riding: what is being sent, who hands it over, who
 * receives it, and the window it must land in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { DEFAULT_WINDOW_HOURS, PARCEL_LABELS, PARCEL_NOTES, PARCEL_SIZES, describeDeliveryTariff, type ParcelSize, HANDOVER_KINDS, HANDOVER_LABELS, DEFAULT_HANDOVER, type HandoverKind } from "@shared/deliveries";
import { payerOf, type Payer } from "@shared/recipientPay";
import { handoverOf } from "@shared/deliveries";

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}
const money = (n: string | number) => `$${Number(n ?? 0).toFixed(2)}`;

export interface DeliveryPrefill {
  parcelSize?: string; handover?: string; payer?: string;
  pickupContact?: { name?: string | null; phone?: string | null } | null;
  dropContact?: { name?: string | null; phone?: string | null; note?: string | null } | null;
  pickup?: { lat: number; lng: number; address: string } | null;
  destination?: { lat: number; lng: number; address: string } | null;
}
interface SavedRecipient { id: string; name: string; phone: string | null; address: { lat: number; lng: number; address: string }; handover: string; note: string | null }

export function BookDeliveryDrawer({ orgId, orgName, defaultPayer = "organization", orgAddress, prefill, onClose }: { orgId: string; orgName: string; defaultPayer?: string; orgAddress?: { lat?: number; lng?: number; address?: string } | null; prefill?: DeliveryPrefill | null; onClose: () => void }) {
  const { toast } = useToast();
  const first = useRef<HTMLInputElement>(null);
  // "Send again" opens the drawer filled from a past job; otherwise the
  // pickup starts at the organization's own address when it has one.
  const startPickup = prefill?.pickup ?? (orgAddress?.address && Number.isFinite(orgAddress.lat) && Number.isFinite(orgAddress.lng) ? { lat: Number(orgAddress.lat), lng: Number(orgAddress.lng), address: String(orgAddress.address) } : null);
  const toSuggestion = (l: { lat: number; lng: number; address: string } | null | undefined): AddressSuggestion | null => l ? { lat: l.lat, lng: l.lng, label: l.address } : null;
  const [parcelSize, setParcelSize] = useState<ParcelSize>((prefill?.parcelSize as ParcelSize) ?? "small");
  const [pickupName, setPickupName] = useState(prefill?.pickupContact?.name ?? "");
  const [pickupPhone, setPickupPhone] = useState(prefill?.pickupContact?.phone ?? "");
  const [dropName, setDropName] = useState(prefill?.dropContact?.name ?? "");
  const [dropPhone, setDropPhone] = useState(prefill?.dropContact?.phone ?? "");
  const [dropNote, setDropNote] = useState(prefill?.dropContact?.note ?? "");
  const [handover, setHandover] = useState<HandoverKind>(handoverOf(prefill?.handover));
  const [payer, setPayer] = useState<Payer>(payerOf(prefill?.payer ?? defaultPayer));
  const [pickupText, setPickupText] = useState(startPickup?.address ?? "");
  const [pickup, setPickup] = useState<AddressSuggestion | null>(toSuggestion(startPickup));
  const [destText, setDestText] = useState(prefill?.destination?.address ?? "");
  const [dest, setDest] = useState<AddressSuggestion | null>(toSuggestion(prefill?.destination));
  const [remember, setRemember] = useState(true);
  const [recipientId, setRecipientId] = useState("");
  const { data: recipients = [] } = useQuery<SavedRecipient[]>({ queryKey: ["/api/org", orgId, "recipients"], queryFn: () => json("GET", `/api/org/${orgId}/recipients`) });
  const pickRecipient = (id: string) => {
    setRecipientId(id);
    const r = recipients.find((x) => x.id === id);
    if (!r) return;
    setDropName(r.name); setDropPhone(r.phone ?? ""); setDropNote(r.note ?? ""); setHandover(handoverOf(r.handover));
    setDest(toSuggestion(r.address)); setDestText(r.address.address);
  };
  const [readyAt, setReadyAt] = useState("");
  const [windowHours, setWindowHours] = useState("2");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { first.current?.focus(); }, []);

  const ready = !!(pickupName.trim() && dropName.trim() && pickup && dest && readyAt) && (payer !== "recipient" || dropPhone.trim().length > 0);
  const book = useMutation({
    mutationFn: () => json<{ job: { jobLabel: string }; ride: { estimatedFare: string }; recipientPay: { link: string; textSent: boolean } | null }>("POST", `/api/org/${orgId}/deliveries`, {
      parcelSize,
      pickupContact: { name: pickupName, phone: pickupPhone },
      dropContact: { name: dropName, phone: dropPhone, note: dropNote },
      handover,
      payer,
      pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label },
      destination: { lat: dest!.lat, lng: dest!.lng, address: dest!.label },
      readyAt: new Date(readyAt).toISOString(),
      windowHours: Number(windowHours) || DEFAULT_WINDOW_HOURS,
      poNumber, notes,
      rememberRecipient: remember,
    }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "recipients"] });
      if (r.recipientPay) {
        toast({ title: `Booked ${r.job.jobLabel} — waiting for the recipient`, description: r.recipientPay.textSent ? `${money(r.ride.estimatedFare)} to be paid by the recipient. They have a text with the link; the job goes to drivers once paid.` : `${money(r.ride.estimatedFare)} to be paid by the recipient. Texts are not set up: copy the pay link from the job row and send it yourself.` });
      } else {
        toast({ title: `Booked ${r.job.jobLabel}`, description: `${money(r.ride.estimatedFare)}, billed to ${orgName}.` });
      }
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
          {recipients.length > 0 && (
            <Select value={recipientId} onValueChange={pickRecipient}>
              <SelectTrigger data-testid="select-portal-recipient"><SelectValue placeholder="Deliver to a saved recipient…" /></SelectTrigger>
              <SelectContent>{recipients.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.phone ? ` · ${r.phone}` : ""} · {r.address.address}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Input placeholder="Who receives it" value={dropName} onChange={(e) => setDropName(e.target.value)} data-testid="input-portal-drop-contact" />
          <Input placeholder="Their phone (optional)" value={dropPhone} onChange={(e) => setDropPhone(e.target.value)} data-testid="input-portal-drop-phone" />
        </div>
        <AddressAutocomplete value={destText} onChange={(v) => { setDestText(v); setDest(null); }} onSelect={(s) => { setDest(s); setDestText(s.label); }} placeholder="Deliver to" data-testid="input-portal-delivery-destination" />
        <Input placeholder="Where to find them: suite, floor, ask at reception…" value={dropNote} onChange={(e) => setDropNote(e.target.value)} data-testid="input-portal-drop-note" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="checkbox-portal-remember-recipient" /> Remember this recipient for next time</label>
        <label className="text-xs font-medium text-muted-foreground">Who pays the delivery fee</label>
        <Select value={payer} onValueChange={(v) => setPayer(payerOf(v))}>
          <SelectTrigger data-testid="select-portal-payer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="organization">Bill my account</SelectItem>
            <SelectItem value="recipient">The recipient pays (texted a link; sent once paid)</SelectItem>
          </SelectContent>
        </Select>
        {payer === "recipient" && !dropPhone.trim() ? <p className="text-xs text-amber-700" data-testid="text-portal-payer-needs-phone">The recipient's phone is needed: that is where the pay link goes.</p> : null}
        <label className="text-xs font-medium text-muted-foreground">How it changes hands</label>
        <Select value={handover} onValueChange={(v) => setHandover(v as HandoverKind)}>
          <SelectTrigger data-testid="select-portal-handover"><SelectValue /></SelectTrigger>
          <SelectContent>{HANDOVER_KINDS.map((k) => <SelectItem key={k} value={k}>{HANDOVER_LABELS[k]}</SelectItem>)}</SelectContent>
        </Select>

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
