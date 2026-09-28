/**
 * My cars — a private owner's tab on the rental page (Car Rental Master
 * Plan, phase 2). Add a car with its papers, see PG Ride's check, list or
 * hide it, say how to be paid, and run the rentals of your own cars:
 * accept, hand over, take back. PG Ride keeps 10% of what each rental
 * collects; the owner is credited the rest and paid every Friday.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Handover, PhotoPicker, pathOf, uploadTarget } from "@/components/admin/RentalPanel";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { MIN_PHOTOS, OWNER_PAYOUT_METHODS, RENTAL_STATUS_WORDS, money, type RentalBookingStatus } from "@shared/rental";

interface OwnerCar {
  id: string; make: string; model: string; year: number; licensePlate: string; status: string; reviewStatus: string; reviewNote: string | null;
  dailyPrice: string; deposit: string; photos: string[]; problems: string[]; hiddenReason: string | null;
}
interface OwnerBooking {
  id: string; status: RentalBookingStatus; startsAt: string; endsAt: string; days: number; rentalTotal: string; licenceNumber: string; licenceImageUrl: string;
  paymentError: string | null; ownerShare: string | null; renter: { firstName: string }; car: { make: string; model: string; year: number; licensePlate: string };
}
const when = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function DocUpload({ onChange, children }: { onChange: (v: string) => void; children: ReactNode }) {
  return (
    <ObjectUploader maxNumberOfFiles={1} onGetUploadParameters={uploadTarget} onComplete={(r) => { const u = r.successful[0]?.uploadURL; if (u) onChange(pathOf(u)); }} buttonClassName="w-full border rounded-md py-2 text-xs">
      {children}
    </ObjectUploader>
  );
}

export function MyCars() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ cars: OwnerCar[]; payout: { payoutMethod: string; payoutDetails: string } | null; terms: string }>({ queryKey: ["/api/rent/my-cars"] });
  const { data: bookings } = useQuery<OwnerBooking[]>({ queryKey: ["/api/rent/my-cars/bookings"], refetchInterval: 30_000 });
  const [adding, setAdding] = useState(false);
  const [handling, setHandling] = useState<{ id: string; kind: "collect" | "return" } | null>(null);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/rent/my-cars"] }); queryClient.invalidateQueries({ queryKey: ["/api/rent/my-cars/bookings"] }); };
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "listed" | "hidden" }) => (await apiRequest("PATCH", `/api/rent/my-cars/${id}`, { status })).json(),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Could not change the listing", description: e.message, variant: "destructive" }),
  });
  const act = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: any }) => (await apiRequest("POST", `/api/rent/my-cars/bookings/${id}/${action}`, body ?? {})).json(),
    onSuccess: (b: any) => { toast({ title: "Done", description: b?.paymentError ? `Recorded. ${b.paymentError}` : `The rental is now ${b?.status}.` }); setHandling(null); refresh(); },
    onError: (e: Error) => toast({ title: "Could not do that", description: e.message, variant: "destructive" }),
  });
  if (isLoading) return <div className="p-4"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  return (
    <div className="px-4 pt-4 space-y-4" data-testid="my-cars">
      <p className="text-xs text-muted-foreground">{data?.terms}</p>
      <PayoutForm current={data?.payout ?? null} onSaved={refresh} />
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">Your cars</h2>
        <Button size="sm" variant={adding ? "outline" : "default"} onClick={() => setAdding((v) => !v)} data-testid="button-owner-add-car">{adding ? "Close" : "List a car"}</Button>
      </div>
      {adding && <OwnerCarForm onDone={() => { setAdding(false); refresh(); }} />}
      {(data?.cars.length ?? 0) === 0 && !adding && <p className="text-sm text-muted-foreground" data-testid="text-no-owner-cars">You have not listed a car yet.</p>}
      {data?.cars.map((c) => (
        <Card key={c.id} data-testid={`card-owner-car-${c.id}`}>
          <CardContent className="p-4 space-y-1">
            <div className="flex justify-between"><p className="font-semibold">{c.year} {c.make} {c.model} · {c.licensePlate}</p><Badge variant={c.status === "listed" ? "default" : "secondary"}>{c.status}</Badge></div>
            <p className="text-xs text-muted-foreground">{money(c.dailyPrice)}/day · deposit {money(c.deposit)} · papers {c.reviewStatus === "approved" ? "checked" : c.reviewStatus === "rejected" ? "sent back" : "waiting for PG Ride"}</p>
            {c.reviewNote && <p className="text-xs">PG Ride: {c.reviewNote}</p>}
            {c.problems.length > 0 && <ul className="text-xs text-destructive list-disc pl-4">{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {c.status === "listed"
              ? <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: c.id, status: "hidden" })} data-testid={`button-owner-hide-car-${c.id}`}>Take off the list</Button>
              : <Button size="sm" disabled={c.problems.length > 0 || !data?.payout} onClick={() => setStatus.mutate({ id: c.id, status: "listed" })} data-testid={`button-owner-list-car-${c.id}`}>List for rent</Button>}
          </CardContent>
        </Card>
      ))}
      <h2 className="font-semibold pt-2">Rentals of your cars</h2>
      {(bookings?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-owner-rentals">No one has asked for your cars yet.</p>}
      {bookings?.map((b) => (
        <Card key={b.id} data-testid={`card-owner-rental-${b.id}`}>
          <CardContent className="p-4 space-y-1">
            <p className="font-medium">{b.renter.firstName} · {b.car.year} {b.car.make} {b.car.model}</p>
            <p className="text-xs text-muted-foreground">{when(b.startsAt)} → {when(b.endsAt)} · {money(b.rentalTotal)} · licence {b.licenceNumber} (<a className="underline" href={b.licenceImageUrl} target="_blank" rel="noreferrer">photo</a>)</p>
            <p className="text-sm">{RENTAL_STATUS_WORDS[b.status] ?? b.status}{b.ownerShare ? ` · you are credited ${money(b.ownerShare)}` : ""}</p>
            {b.paymentError && <p className="text-xs text-destructive">{b.paymentError}</p>}
            <div className="flex flex-wrap gap-2">
              {b.status === "requested" && <>
                <Button size="sm" onClick={() => act.mutate({ id: b.id, action: "confirm" })} data-testid={`button-owner-confirm-${b.id}`}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: b.id, action: "decline", body: { reason: "Not available" } })} data-testid={`button-owner-decline-${b.id}`}>Decline</Button>
              </>}
              {b.status === "confirmed" && <Button size="sm" onClick={() => setHandling({ id: b.id, kind: "collect" })} data-testid={`button-owner-handover-${b.id}`}>Hand over</Button>}
              {b.status === "collected" && <Button size="sm" onClick={() => setHandling({ id: b.id, kind: "return" })} data-testid={`button-owner-takeback-${b.id}`}>Take back</Button>}
              {b.status === "returned" && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: b.id, action: "settle" })} data-testid={`button-owner-settle-${b.id}`}>Retry settlement</Button>}
            </div>
            {handling?.id === b.id && <Handover kind={handling.kind} pending={act.isPending} onSubmit={(body) => act.mutate({ id: b.id, action: handling.kind, body })} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PayoutForm({ current, onSaved }: { current: { payoutMethod: string; payoutDetails: string } | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [method, setMethod] = useState(current?.payoutMethod ?? "zelle");
  const [details, setDetails] = useState(current?.payoutDetails ?? "");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/rent/owner-payout", { payoutMethod: method, payoutDetails: details })).json(),
    onSuccess: () => { toast({ title: "Saved", description: "You are paid every Friday." }); onSaved(); },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  return (
    <Card><CardContent className="p-4 space-y-2">
      <p className="font-semibold text-sm">How you are paid (every Friday)</p>
      <div className="flex gap-2">
        <select className="border rounded-md h-9 px-2 text-sm bg-background" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="select-owner-payout">
          {OWNER_PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m === "cashapp" ? "Cash App" : m === "paypal" ? "PayPal" : m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>
        <Input placeholder="Email, phone, $cashtag or address" value={details} onChange={(e) => setDetails(e.target.value)} data-testid="input-owner-payout" />
      </div>
      <Button size="sm" disabled={save.isPending || details.length < 3} onClick={() => save.mutate()} data-testid="button-owner-save-payout">{current ? "Update" : "Save"}</Button>
    </CardContent></Card>
  );
}

function OwnerCarForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ make: "", model: "", year: "", color: "", seats: "5", vehicleType: "standard", licensePlate: "", vin: "", dailyPrice: "", deposit: "", milesPerDay: "150", extraMileFee: "0.40", lateHourFee: "15", inspectionExpires: "", registrationExpires: "", insuranceExpires: "" });
  const [docs, setDocs] = useState({ registrationDocUrl: "", insuranceDocUrl: "", inspectionDocUrl: "", ownershipDocUrl: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [address, setAddress] = useState("");
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/rent/my-cars", { ...f, ...docs, year: Number(f.year), seats: Number(f.seats), milesPerDay: Number(f.milesPerDay), photos, pickupLocation: pickup })).json(),
    onSuccess: () => { toast({ title: "Car sent to PG Ride", description: "PG Ride checks the papers; then you can list it." }); onDone(); },
    onError: (e: Error) => toast({ title: "Could not add the car", description: e.message, variant: "destructive" }),
  });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">{label}<Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-owner-${k}`} /></label>
  );
  return (
    <Card data-testid="form-owner-car"><CardContent className="p-4 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {field("make", "Make")}{field("model", "Model")}{field("year", "Model year", "number")}{field("color", "Colour")}
        {field("seats", "Seats incl. driver", "number")}
        <label className="text-xs text-muted-foreground">Class
          <select className="w-full border rounded-md h-9 px-2 text-sm bg-background" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} data-testid="select-owner-class">
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        {field("licensePlate", "Plate")}{field("vin", "VIN (17 characters)")}
        {field("dailyPrice", "Price per day ($)", "number")}{field("deposit", "Deposit ($)", "number")}
        {field("milesPerDay", "Miles a day (0 = unlimited)", "number")}{field("extraMileFee", "Per extra mile ($)", "number")}
        {field("lateHourFee", "Per late hour ($)", "number")}
        {field("inspectionExpires", "Inspection expires", "date")}{field("registrationExpires", "Registration expires", "date")}{field("insuranceExpires", "Insurance expires", "date")}
      </div>
      <AddressAutocomplete value={address} onChange={(v) => { setAddress(v); setPickup(null); }} onSelect={(s) => { setAddress(s.label); setPickup({ lat: s.lat, lng: s.lng, address: s.label }); }} placeholder="Where renters collect the car" data-testid="input-owner-pickup" />
      <PhotoPicker photos={photos} setPhotos={setPhotos}><span data-testid="button-owner-photos">Add photos of the car (at least {MIN_PHOTOS}) ({photos.length} added)</span></PhotoPicker>
      <div className="grid grid-cols-2 gap-2">
        <DocUpload onChange={(v) => setDocs({ ...docs, registrationDocUrl: v })}><span data-testid="button-owner-doc-registration">{docs.registrationDocUrl ? "registration card ✓" : "Add registration card"}</span></DocUpload>
        <DocUpload onChange={(v) => setDocs({ ...docs, insuranceDocUrl: v })}><span data-testid="button-owner-doc-insurance">{docs.insuranceDocUrl ? "insurance card ✓" : "Add insurance card"}</span></DocUpload>
        <DocUpload onChange={(v) => setDocs({ ...docs, inspectionDocUrl: v })}><span data-testid="button-owner-doc-inspection">{docs.inspectionDocUrl ? "inspection certificate ✓" : "Add inspection certificate"}</span></DocUpload>
        <DocUpload onChange={(v) => setDocs({ ...docs, ownershipDocUrl: v })}><span data-testid="button-owner-doc-ownership">{docs.ownershipDocUrl ? "proof of ownership ✓" : "Add proof of ownership"}</span></DocUpload>
      </div>
      <Button className="w-full" disabled={save.isPending || !f.make || !f.model || !f.year || !f.color || !f.licensePlate || !f.dailyPrice} onClick={() => save.mutate()} data-testid="button-owner-save-car">{save.isPending ? "Sending…" : "Send to PG Ride to check"}</Button>
    </CardContent></Card>
  );
}
