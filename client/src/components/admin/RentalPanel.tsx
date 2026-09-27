/**
 * Admin — Car rental (PG Ride Car Rental Master Plan, phase 1).
 * PG Ride lists its own fleet cars, confirms or declines requests, hands a
 * car over (the rental is charged and the deposit held there), takes it back
 * (the deposit is settled there), and retries a settlement that failed.
 * Shown only while RENTAL_ENABLED is on.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ObjectUploader } from "@/components/ObjectUploader";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { money, MIN_PHOTOS } from "@shared/rental";

interface AdminCar {
  id: string; make: string; model: string; year: number; color: string; seats: number; vehicleType: string; licensePlate: string; vin: string | null;
  photos: string[]; dailyPrice: string; deposit: string; milesPerDay: number; extraMileFee: string; lateHourFee: string;
  pickupLocation: { address: string } | null; inspectionExpires: string | null; registrationExpires: string | null; insuranceExpires: string | null;
  status: "listed" | "hidden"; hiddenReason: string | null; problems: string[]; weeklyDriverRent: string | null;
  ownerKind: string; reviewStatus: string; reviewNote: string | null;
  registrationDocUrl: string | null; insuranceDocUrl: string | null; inspectionDocUrl: string | null; ownershipDocUrl: string | null;
}
interface AdminAssignment {
  id: string; status: string; startsAt: string; endsAt: string; weeks: number; weeklyRent: string; paidThrough: string | null;
  paymentStatus: string; paymentError: string | null; damageAmount: string | null; damageIntentId: string | null;
  car: { make: string; model: string; year: number; licensePlate: string }; driver: { name: string; approvalStatus: string };
}
interface AdminBooking {
  id: string; status: string; startsAt: string; endsAt: string; days: number; rentalTotal: string; deposit: string; licenceNumber: string; licenceImageUrl: string;
  paymentStatus: string; paymentError: string | null; settlement: Record<string, number> | null; collectOdometer: number | null;
  car: { make: string; model: string; year: number; licensePlate: string };
}

const REFRESH = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;
const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "");
const when = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function uploadTarget() {
  const res = await apiRequest("POST", "/api/objects/upload?store=db", {});
  const { uploadURL } = await res.json();
  return { method: "PUT" as const, url: uploadURL };
}
export const pathOf = (u: string) => new URL(u, window.location.origin).pathname;

export function PhotoPicker({ photos, setPhotos, children }: { photos: string[]; setPhotos: (p: string[]) => void; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <ObjectUploader maxNumberOfFiles={8} onGetUploadParameters={uploadTarget} onComplete={(r) => setPhotos([...photos, ...r.successful.map((f) => pathOf(f.uploadURL))])} buttonClassName="w-full border rounded-md py-2 text-sm">
        {children}
      </ObjectUploader>
    </div>
  );
}

function OwnerCarReview({ carId }: { carId: string }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: async (decision: "approve" | "reject") => (await apiRequest("POST", `/api/admin/rental/cars/${carId}/review`, { decision, note })).json(),
    onSuccess: (c: any) => { toast({ title: c.reviewStatus === "approved" ? "Papers accepted" : "Sent back", description: c.reviewStatus === "approved" ? "The owner can list it now." : "The owner is shown your note." }); queryClient.invalidateQueries({ queryKey: ["/api/admin/rental/cars"] }); },
    onError: (e: Error) => toast({ title: "Could not record the check", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Input className="h-8 max-w-xs" placeholder="Note to the owner (needed to send back)" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-review-note-${carId}`} />
      <Button size="sm" disabled={review.isPending} onClick={() => review.mutate("approve")} data-testid={`button-approve-owner-car-${carId}`}>Papers are right</Button>
      <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate("reject")} data-testid={`button-sendback-owner-car-${carId}`}>Send back</Button>
    </div>
  );
}

export function RentalPanel() {
  return (
    <div className="space-y-6" data-testid="rental-panel">
      <div>
        <h2 className="text-2xl font-bold">Car rental</h2>
        <p className="text-sm text-muted-foreground">PG Ride's own fleet. A car is listed only while it qualifies; the sweep hides it the hour a document lapses.</p>
      </div>
      <RentalBookings />
      <DriverCars />
      <FleetCars />
    </div>
  );
}

function FleetCars() {
  const { toast } = useToast();
  const { data: cars } = useQuery<AdminCar[]>({ queryKey: ["/api/admin/rental/cars"], ...REFRESH });
  const [adding, setAdding] = useState(false);
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "listed" | "hidden" }) => (await apiRequest("PATCH", `/api/admin/rental/cars/${id}`, { status })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/rental/cars"] }),
    onError: (e: Error) => toast({ title: "Could not change the listing", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle>Cars</CardTitle><CardDescription>{cars?.filter((c) => c.status === "listed").length ?? 0} listed of {cars?.length ?? 0}</CardDescription></div>
        <Button size="sm" onClick={() => setAdding((v) => !v)} data-testid="button-add-fleet-car">{adding ? "Close" : "Add a car"}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && <CarForm onDone={() => setAdding(false)} />}
        {cars?.map((car) => (
          <div key={car.id} className="border rounded-md p-3 space-y-1" data-testid={`row-fleet-car-${car.id}`}>
            <div className="flex justify-between items-center">
              <p className="font-medium">{car.year} {car.make} {car.model} · {car.licensePlate}</p>
              <div className="flex gap-1">{car.ownerKind === "private" && <Badge variant="outline">private · {car.reviewStatus}</Badge>}<Badge variant={car.status === "listed" ? "default" : "secondary"}>{car.status}</Badge></div>
            </div>
            {car.ownerKind === "private" && (
              <div className="text-xs space-x-2">
                {([["registration", car.registrationDocUrl], ["insurance", car.insuranceDocUrl], ["inspection", car.inspectionDocUrl], ["ownership", car.ownershipDocUrl]] as const).map(([n, u]) => u ? <a key={n} className="underline" href={u} target="_blank" rel="noreferrer">{n}</a> : <span key={n} className="text-destructive">no {n}</span>)}
                {car.reviewNote && <span className="text-muted-foreground">· {car.reviewNote}</span>}
              </div>
            )}
            {car.ownerKind === "private" && car.reviewStatus === "pending" && <OwnerCarReview carId={car.id} />}
            <p className="text-xs text-muted-foreground">{money(car.dailyPrice)}/day · deposit {money(car.deposit)} · {car.weeklyDriverRent ? `drivers ${money(car.weeklyDriverRent)}/week` : "not offered to drivers"} · {car.photos.length} photos · inspection {day(car.inspectionExpires) || "—"} · registration {day(car.registrationExpires) || "—"} · insurance {day(car.insuranceExpires) || "—"}</p>
            {car.problems.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{car.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {car.status === "hidden" && car.hiddenReason && car.problems.length === 0 && <p className="text-xs text-muted-foreground">{car.hiddenReason}</p>}
            {car.status === "listed"
              ? <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: car.id, status: "hidden" })} data-testid={`button-hide-car-${car.id}`}>Take off the list</Button>
              : <Button size="sm" disabled={car.problems.length > 0} onClick={() => setStatus.mutate({ id: car.id, status: "listed" })} data-testid={`button-list-car-${car.id}`}>List for rent</Button>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CarForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ make: "", model: "", year: "", color: "", seats: "5", vehicleType: "standard", licensePlate: "", vin: "", dailyPrice: "", deposit: "", milesPerDay: "150", extraMileFee: "0.40", lateHourFee: "15", weeklyDriverRent: "", inspectionExpires: "", registrationExpires: "", insuranceExpires: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [address, setAddress] = useState("");
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/rental/cars", { ...f, year: Number(f.year), seats: Number(f.seats), milesPerDay: Number(f.milesPerDay), photos, pickupLocation: pickup })).json(),
    onSuccess: () => { toast({ title: "Car added", description: "It is hidden until you list it." }); queryClient.invalidateQueries({ queryKey: ["/api/admin/rental/cars"] }); onDone(); },
    onError: (e: Error) => toast({ title: "Could not add the car", description: e.message, variant: "destructive" }),
  });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">{label}<Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-fleet-${k}`} /></label>
  );
  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30" data-testid="form-fleet-car">
      <div className="grid grid-cols-2 gap-2">
        {field("make", "Make")}{field("model", "Model")}{field("year", "Model year", "number")}{field("color", "Colour")}
        {field("seats", "Seats incl. driver", "number")}
        <label className="text-xs text-muted-foreground">Class
          <select className="w-full border rounded-md h-9 px-2 text-sm bg-background" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} data-testid="select-fleet-class">
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        {field("licensePlate", "Plate")}{field("vin", "VIN (17 characters)")}
        {field("dailyPrice", "Price per day ($)", "number")}{field("deposit", "Deposit ($)", "number")}
        {field("milesPerDay", "Miles a day (0 = unlimited)", "number")}{field("extraMileFee", "Per extra mile ($)", "number")}
        {field("lateHourFee", "Per late hour ($)", "number")}{field("weeklyDriverRent", "Weekly rent for a driver ($, blank = not offered)", "number")}
        {field("inspectionExpires", "Inspection expires", "date")}{field("registrationExpires", "Registration expires", "date")}{field("insuranceExpires", "Insurance expires", "date")}
      </div>
      <AddressAutocomplete value={address} onChange={(v) => { setAddress(v); setPickup(null); }} onSelect={(s) => { setAddress(s.label); setPickup({ lat: s.lat, lng: s.lng, address: s.label }); }} placeholder="Pick-up place" data-testid="input-fleet-pickup" />
      <PhotoPicker photos={photos} setPhotos={setPhotos}><span data-testid="button-fleet-photos">Add photos of the car (at least {MIN_PHOTOS}) ({photos.length} added)</span></PhotoPicker>
      <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-save-fleet-car">{save.isPending ? "Saving…" : "Save car (hidden until listed)"}</Button>
    </div>
  );
}

function RentalBookings() {
  const { toast } = useToast();
  const { data: bookings } = useQuery<AdminBooking[]>({ queryKey: ["/api/admin/rental/bookings"], ...REFRESH });
  const [handling, setHandling] = useState<{ id: string; kind: "collect" | "return" } | null>(null);
  const act = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: any }) => (await apiRequest("POST", `/api/admin/rental/bookings/${id}/${action}`, body ?? {})).json(),
    onSuccess: (b: any) => {
      toast({ title: "Done", description: b?.paymentError ? `Recorded. ${b.paymentError}` : `The rental is now ${b?.status}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rental/bookings"] });
      setHandling(null);
    },
    onError: (e: Error) => toast({ title: "Could not do that", description: e.message, variant: "destructive" }),
  });
  const open = bookings?.filter((b) => !["closed", "declined", "cancelled"].includes(b.status)) ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Rentals</CardTitle><CardDescription>{open.length} open · the rental is charged and the deposit held at hand-over</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {(bookings?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-rental-bookings">No rentals yet.</p>}
        {bookings?.map((b) => (
          <div key={b.id} className="border rounded-md p-3 space-y-1" data-testid={`row-rental-${b.id}`}>
            <div className="flex justify-between"><p className="font-medium">{b.car.year} {b.car.make} {b.car.model} · {b.car.licensePlate}</p><Badge variant="secondary">{b.status}</Badge></div>
            <p className="text-xs text-muted-foreground">{when(b.startsAt)} → {when(b.endsAt)} · {money(b.rentalTotal)} · deposit {money(b.deposit)} · licence {b.licenceNumber} (<a className="underline" href={b.licenceImageUrl} target="_blank" rel="noreferrer">photo</a>)</p>
            {b.paymentError && <p className="text-xs text-destructive">{b.paymentError}</p>}
            {b.settlement && <p className="text-xs text-muted-foreground">Driven {b.settlement.milesDriven} mi · extras {money(b.settlement.extrasTotal)} · from deposit {money(b.settlement.fromDeposit)} · beyond {money(b.settlement.beyondDeposit)}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {b.status === "requested" && <>
                <Button size="sm" onClick={() => act.mutate({ id: b.id, action: "confirm" })} data-testid={`button-confirm-rental-${b.id}`}>Confirm</Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: b.id, action: "decline", body: { reason: "Not available" } })} data-testid={`button-decline-rental-${b.id}`}>Decline</Button>
              </>}
              {b.status === "confirmed" && <Button size="sm" onClick={() => setHandling({ id: b.id, kind: "collect" })} data-testid={`button-handover-rental-${b.id}`}>Hand over</Button>}
              {b.status === "collected" && <Button size="sm" onClick={() => setHandling({ id: b.id, kind: "return" })} data-testid={`button-takeback-rental-${b.id}`}>Take back</Button>}
              {b.status === "returned" && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: b.id, action: "settle" })} data-testid={`button-settle-rental-${b.id}`}>Retry settlement</Button>}
            </div>
            {handling?.id === b.id && <Handover kind={handling.kind} pending={act.isPending} onSubmit={(body) => act.mutate({ id: b.id, action: handling.kind, body })} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function Handover({ kind, pending, onSubmit, label }: { kind: "collect" | "return"; pending: boolean; onSubmit: (body: any) => void; label?: string }) {
  const [odometer, setOdometer] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [damageAmount, setDamageAmount] = useState("");
  const [damageNote, setDamageNote] = useState("");
  return (
    <div className="border-t pt-2 space-y-2" data-testid={`form-rental-${kind}`}>
      <Input type="number" placeholder="Odometer reading" value={odometer} onChange={(e) => setOdometer(e.target.value)} data-testid={`input-rental-odometer-${kind}`} />
      <PhotoPicker photos={photos} setPhotos={setPhotos}><span data-testid={`button-rental-photos-${kind}`}>Photos: front, back, both sides ({photos.length} added)</span></PhotoPicker>
      {kind === "return" && <div className="grid grid-cols-2 gap-2">
        <Input type="number" placeholder="Damage ($, if any)" value={damageAmount} onChange={(e) => setDamageAmount(e.target.value)} data-testid="input-rental-damage" />
        <Input placeholder="What is damaged" value={damageNote} onChange={(e) => setDamageNote(e.target.value)} data-testid="input-rental-damage-note" />
      </div>}
      <Button size="sm" className="w-full" disabled={pending || !odometer || photos.length < 4} onClick={() => onSubmit({ odometer: Number(odometer), photos, ...(kind === "return" ? { damageAmount: damageAmount || undefined, damageNote } : {}) })} data-testid={`button-submit-rental-${kind}`}>
        {label ?? (kind === "collect" ? "Charge the rental, hold the deposit, hand over" : "Take the car back and settle the deposit")}
      </Button>
    </div>
  );
}

function DriverCars() {
  const { toast } = useToast();
  const { data: rows } = useQuery<AdminAssignment[]>({ queryKey: ["/api/admin/rental/assignments"], ...REFRESH });
  const [handling, setHandling] = useState<{ id: string; kind: "handover" | "takeback" } | null>(null);
  const act = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: any }) => (await apiRequest("POST", `/api/admin/rental/assignments/${id}/${action}`, body ?? {})).json(),
    onSuccess: (a: any) => {
      toast({ title: "Done", description: a?.paymentError ? `Recorded. ${a.paymentError}` : `Now ${a?.status}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rental/assignments"] });
      setHandling(null);
    },
    onError: (e: Error) => toast({ title: "Could not do that", description: e.message, variant: "destructive" }),
  });
  const open = rows?.filter((r) => ["requested", "assigned", "active"].includes(r.status)) ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Cars for drivers</CardTitle><CardDescription>{open.length} open · only PG Ride's own cars · rent is charged a week at a time, in advance</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {(rows?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-driver-cars">No driver has asked for a car yet.</p>}
        {rows?.map((r) => (
          <div key={r.id} className="border rounded-md p-3 space-y-1" data-testid={`row-driver-car-${r.id}`}>
            <div className="flex justify-between"><p className="font-medium">{r.driver.name} · {r.car.year} {r.car.make} {r.car.model} ({r.car.licensePlate})</p><Badge variant="secondary">{r.status}</Badge></div>
            <p className="text-xs text-muted-foreground">{when(r.startsAt)} → {when(r.endsAt)} · {r.weeks} week{r.weeks === 1 ? "" : "s"} at {money(r.weeklyRent)} · driver {r.driver.approvalStatus}{r.paidThrough ? ` · paid to ${when(r.paidThrough)}` : ""}</p>
            {r.paymentError && <p className="text-xs text-destructive">{r.paymentError}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {r.status === "requested" && <>
                <Button size="sm" onClick={() => act.mutate({ id: r.id, action: "assign" })} data-testid={`button-assign-driver-car-${r.id}`}>Assign</Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: "decline", body: { reason: "Not available" } })} data-testid={`button-decline-driver-car-${r.id}`}>Decline</Button>
              </>}
              {r.status === "assigned" && <Button size="sm" onClick={() => setHandling({ id: r.id, kind: "handover" })} data-testid={`button-handover-driver-car-${r.id}`}>Hand over</Button>}
              {r.status === "active" && <>
                <Button size="sm" onClick={() => setHandling({ id: r.id, kind: "takeback" })} data-testid={`button-takeback-driver-car-${r.id}`}>Take back</Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: "extend", body: { weeks: 1 } })} data-testid={`button-extend-driver-car-${r.id}`}>Add a week</Button>
                {r.paymentStatus === "due" && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: "charge-rent" })} data-testid={`button-charge-rent-driver-car-${r.id}`}>Retry rent</Button>}
              </>}
              {r.status === "ended" && r.damageAmount && !r.damageIntentId && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: "charge-damage" })} data-testid={`button-charge-damage-driver-car-${r.id}`}>Retry damage charge</Button>}
            </div>
            {handling?.id === r.id && <Handover kind={handling.kind === "handover" ? "collect" : "return"} label={handling.kind === "handover" ? "Charge the first week's rent and hand over" : "Take the car back (charge any damage)"} pending={act.isPending} onSubmit={(body) => act.mutate({ id: r.id, action: handling.kind, body })} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
