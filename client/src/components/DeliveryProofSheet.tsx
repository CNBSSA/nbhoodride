/**
 * The handover sheet: what a driver records before a parcel is complete.
 * The desk's handover choice decides what is asked (shared/deliveries.ts):
 * a person or reception signs by name; at the door, the photo is the
 * signature (Festus, 2026-09-17: a photo only when nobody signs). No signal
 * at the door does not strand the driver: the photo is kept on the phone,
 * the job completes with "photo pending", and the photo follows.
 */
import { useState } from "react";
import { Camera, CheckCircle } from "lucide-react";
import { SheetPortal } from "@/components/SheetPortal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queueProofPhoto, shrinkPhoto, uploadProofPhoto } from "@/lib/proofPhoto";
import { useAuth } from "@/hooks/useAuth";

export interface DeliveryForCard {
  parcelLabel: string;
  handover: "person" | "reception" | "unattended";
  handoverText: string;
  needsName: boolean;
  needsPhoto: boolean;
  dropContact: { name: string; phone?: string | null; note?: string | null } | null;
  pickupContact: { name: string; phone?: string | null; note?: string | null } | null;
  windowText: string | null;
  proof: { receivedBy?: string | null; photoUrl?: string | null; photoPending?: boolean; signedAt?: string } | null;
}

interface Props {
  rideId: string;
  delivery: DeliveryForCard;
  driverLocation?: { lat: number; lng: number } | null;
  open: boolean;
  onClose: () => void;
  /** Called once the proof is on the server (or safely queued); the caller then completes the ride. */
  onRecorded: () => void;
}

export function DeliveryProofSheet({ rideId, delivery, driverLocation, open, onClose, onRecorded }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  // Blank on purpose: "who took it" is asked, not assumed (a prefilled name
  // would record the expected receiver on a one-tap confirm).
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = (!delivery.needsName || receivedBy.trim().length > 0) && (!delivery.needsPhoto || !!photo);

  const submit = async () => {
    setBusy(true);
    try {
      let photoUrl: string | null = null;
      let photoPending = false;
      let shrunk: Blob | null = null;
      if (photo) {
        shrunk = await shrinkPhoto(photo);
        try {
          photoUrl = await uploadProofPhoto(shrunk);
        } catch (err: any) {
          // A refusal is not "no signal": say so and stop.
          if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) throw new Error(`The photo was refused (${err.status}). Try another photo.`);
          // No signal at the door: keep it on the phone, complete anyway, it
          // follows. If the phone cannot keep it, this throws and nothing is
          // marked pending.
          if (delivery.needsPhoto) { await queueProofPhoto(user?.id ?? "unknown", rideId, shrunk); photoPending = true; }
        }
      }
      const res = await apiRequest("POST", `/api/driver/rides/${rideId}/proof`, {
        receivedBy: receivedBy.trim() || undefined,
        photoUrl: photoUrl ?? undefined,
        photoPending: photoPending || undefined,
        note: note.trim() || undefined,
        lat: driverLocation?.lat, lng: driverLocation?.lng,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Could not record the handover");
      }
      if (photoPending) toast({ title: "Photo saved on this phone", description: "It will upload when you have signal. The job completes now." });
      onRecorded();
    } catch (e: any) {
      toast({ title: "Handover not recorded", description: e?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  // The same shell as the cancel dialogs: one fixed overlay that IS the top
  // layer everywhere on screen, with the card inside it, so the layout audit
  // can prove nothing sits over the confirm button.
  return (
    <SheetPortal>
      <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-4 overflow-y-auto" style={{ height: "100dvh" }} data-testid="delivery-proof-sheet" onClick={() => { if (!busy) onClose(); }}>
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 w-full max-w-md shadow-xl space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="proof-title">
          <div>
            <h3 id="proof-title" className="font-bold text-lg">Record the handover</h3>
            <p className="text-sm text-muted-foreground">{delivery.handoverText}</p>
          </div>
          <p className="text-sm text-muted-foreground">{delivery.parcelLabel}{delivery.dropContact?.note ? ` · ${delivery.dropContact.note}` : ""}</p>
          {delivery.needsName ? (
            <div className="space-y-2">
              <Label htmlFor="proof-received-by">Who took it?</Label>
              <Input id="proof-received-by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder={delivery.dropContact?.name ? `Their name (expecting ${delivery.dropContact.name})` : "Their name"} required data-testid="input-proof-received-by" />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="proof-photo">{delivery.needsPhoto ? "Photo of where you left it" : "Photo (optional)"}</Label>
            <Input id="proof-photo" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} data-testid="input-proof-photo" />
            {photo ? <p className="text-xs text-muted-foreground flex items-center gap-1"><Camera className="h-3 w-3" /> {photo.name}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="proof-note">Note (optional)</Label>
            <Input id="proof-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Left with the neighbor at 4B…" maxLength={300} data-testid="input-proof-note" />
          </div>
          <Button className="w-full min-h-[44px]" disabled={!ready || busy} onClick={submit} data-testid={`button-proof-confirm-${rideId}`}>
            <CheckCircle className="w-4 h-4 mr-2" />
            {busy ? "Recording…" : "Confirm delivery"}
          </Button>
          <Button variant="ghost" className="w-full min-h-[44px]" disabled={busy} onClick={onClose} data-testid={`button-proof-cancel-${rideId}`}>Not yet</Button>
        </div>
      </div>
    </SheetPortal>
  );
}
