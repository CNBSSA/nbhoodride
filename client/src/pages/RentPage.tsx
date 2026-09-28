/**
 * Car rental — the renter's page (PG Ride Car Rental Master Plan, phase 1).
 * Reached from "Rent a car" in the rider home's More options and on Profile;
 * shown only while RENTAL_ENABLED is on. Prices, availability and every rule
 * come from the server (shared/rental.ts); this page only asks and shows.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MyCars } from "@/components/rental/MyCars";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlags, useStripeConfig } from "@/hooks/useStripeConfig";
import { RENTAL_STATUS_WORDS, RENTAL_TERMS_SENTENCE, money, type RentalBookingStatus } from "@shared/rental";

interface PublicCar {
  id: string; make: string; model: string; year: number; color: string; seats: number; vehicleType: string;
  photos: string[]; dailyPrice: string; deposit: string; milesPerDay: number; extraMileFee: string; lateHourFee: string;
  pickupAddress: string | null; ownerKind: string;
}
interface MyRental {
  id: string; status: RentalBookingStatus; startsAt: string; endsAt: string; days: number; rentalTotal: string; deposit: string;
  paymentStatus: string; paymentError: string | null; settlement: Record<string, number> | null; damageNote: string | null; car: PublicCar;
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const when = (s: string) => new Date(s).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function uploadTarget() {
  // Rental photos live in PG Ride's own store, where the server can check them.
  const res = await apiRequest("POST", "/api/objects/upload?store=db", {});
  const { uploadURL } = await res.json();
  return { method: "PUT" as const, url: uploadURL };
}

export default function RentPage() {
  const [, setLocation] = useLocation();
  const { rentalEnabled } = useFeatureFlags();
  const { isLoading: flagsLoading } = useStripeConfig();
  const [tab, setTab] = useState<"find" | "mine" | "cars">("find");
  const start = new Date(Date.now() + 26 * 3600_000); start.setMinutes(0, 0, 0);
  const [from, setFrom] = useState(localInput(start));
  const [to, setTo] = useState(localInput(new Date(start.getTime() + 2 * 86400_000)));

  if (flagsLoading) {
    return <div className="min-h-screen bg-background p-4" data-testid="rent-page-loading"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!rentalEnabled) {
    return (
      <div className="min-h-screen bg-background p-4" data-testid="rent-page-off">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="button-rent-back"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <p className="mt-6 text-sm text-muted-foreground">Car rental is not available yet.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="rent-page">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="button-rent-back"><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-lg font-semibold">Rent a car</h1>
      </div>
      <div className="px-4 pt-3 flex gap-2">
        <Button variant={tab === "find" ? "default" : "outline"} size="sm" onClick={() => setTab("find")} data-testid="button-rent-tab-find">Find a car</Button>
        <Button variant={tab === "mine" ? "default" : "outline"} size="sm" onClick={() => setTab("mine")} data-testid="button-rent-tab-mine">My rentals</Button>
        <Button variant={tab === "cars" ? "default" : "outline"} size="sm" onClick={() => setTab("cars")} data-testid="button-rent-tab-cars">My cars</Button>
      </div>
      {tab === "find" && <FindCars from={from} to={to} setFrom={setFrom} setTo={setTo} onBooked={() => setTab("mine")} />}
      {tab === "mine" && <MyRentals />}
      {tab === "cars" && <MyCars />}
    </div>
  );
}

function FindCars({ from, to, setFrom, setTo, onBooked }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; onBooked: () => void }) {
  const fromIso = from ? new Date(from).toISOString() : "";
  const toIso = to ? new Date(to).toISOString() : "";
  const { data: cars, isLoading } = useQuery<PublicCar[]>({
    queryKey: [`/api/rent/cars?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`],
    enabled: !!fromIso && !!toIso,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="px-4 pt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">Collect
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-rent-from" />
        </label>
        <label className="text-xs text-muted-foreground">Return
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-rent-to" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-rent-terms">{RENTAL_TERMS_SENTENCE}</p>
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {!isLoading && (cars?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-rent-no-cars">No cars are free for those dates. Try other days.</p>
      )}
      {cars?.map((car) => (
        <Card key={car.id} data-testid={`card-rent-car-${car.id}`}>
          <CardContent className="p-4 space-y-2">
            {car.photos?.[0] ? <img src={car.photos[0]} alt={`${car.make} ${car.model}`} className="w-full h-40 object-cover rounded-md" /> : <div className="w-full h-24 rounded-md bg-muted flex items-center justify-center"><Car className="w-8 h-8 text-muted-foreground" /></div>}
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{car.year} {car.make} {car.model}</p>
                <p className="text-xs text-muted-foreground">{car.color} · {car.seats} seats{car.ownerKind === "fleet" ? " · PG Ride fleet" : " · private owner"}</p>
              </div>
              <p className="font-semibold">{money(car.dailyPrice)}<span className="text-xs font-normal text-muted-foreground">/day</span></p>
            </div>
            <p className="text-xs text-muted-foreground">Deposit {money(car.deposit)} held · {car.milesPerDay > 0 ? `${car.milesPerDay} miles a day, then ${money(car.extraMileFee)} a mile` : "unlimited miles"} · pick up at {car.pickupAddress ?? "the PG Ride lot"}</p>
            {open === car.id
              ? <RequestForm car={car} startsAt={from ? new Date(from).toISOString() : ""} endsAt={to ? new Date(to).toISOString() : ""} onDone={() => { setOpen(null); onBooked(); }} />
              : <Button className="w-full" onClick={() => setOpen(car.id)} data-testid={`button-rent-car-${car.id}`}>Rent this car</Button>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface RenterOnFile {
  dateOfBirth: string; licenceNumber: string; licenceIssuedOn: string; licenceExpiresOn: string; licenceImageUrl: string;
  recordStatus: "pending" | "cleared" | "refused"; recordNote: string | null;
}

const RECORD_WORDS: Record<RenterOnFile["recordStatus"], string> = {
  pending: "PG Ride checks your driving record before your first rental is confirmed.",
  cleared: "Your driving record is checked and cleared.",
  refused: "Your driving record did not clear.",
};

function RequestForm({ car, startsAt, endsAt, onDone }: { car: PublicCar; startsAt: string; endsAt: string; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useQuery<{ renter: RenterOnFile | null; rules: string }>({ queryKey: ["/api/rent/me"] });
  const onFile = me?.renter ?? null;
  const [licenceNumber, setLicenceNumber] = useState("");
  const [licenceImageUrl, setLicenceImageUrl] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [licenceIssuedOn, setLicenceIssuedOn] = useState("");
  const [licenceExpiresOn, setLicenceExpiresOn] = useState("");
  // What is typed wins; what is on file fills the rest.
  const facts = {
    licenceNumber: licenceNumber || onFile?.licenceNumber || "",
    licenceImageUrl: licenceImageUrl || onFile?.licenceImageUrl || "",
    dateOfBirth: dateOfBirth || onFile?.dateOfBirth || "",
    licenceIssuedOn: licenceIssuedOn || onFile?.licenceIssuedOn || "",
    licenceExpiresOn: licenceExpiresOn || onFile?.licenceExpiresOn || "",
  };
  const dobForQuote = /^\d{4}-\d{2}-\d{2}$/.test(facts.dateOfBirth) ? facts.dateOfBirth : "";
  const { data: q, error } = useQuery<{ quote: { days: number; rentalTotal: number; youngRenterFee: number; deposit: number; milesAllowed: number }; available: boolean; ageKnown: boolean }>({
    queryKey: ["/api/rent/quote", car.id, startsAt, endsAt, dobForQuote],
    queryFn: async () => (await apiRequest("POST", "/api/rent/quote", { carId: car.id, startsAt, endsAt, ...(dobForQuote ? { dateOfBirth: dobForQuote } : {}) })).json(),
    retry: false,
  });
  const request = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/rent/bookings", { carId: car.id, startsAt, endsAt, ...facts })).json(),
    onSuccess: () => {
      toast({ title: "Rental requested", description: "PG Ride confirms it shortly. Nothing is charged until you collect the car." });
      queryClient.invalidateQueries({ queryKey: ["/api/rent/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent/me"] });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Could not request the rental", description: e.message, variant: "destructive" }),
  });
  if (error) return <p className="text-sm text-destructive" data-testid="text-rent-quote-error">{(error as Error).message}</p>;
  if (!q) return <Loader2 className="w-4 h-4 animate-spin" />;
  return (
    <div className="space-y-3 border-t pt-3" data-testid="rent-request-form">
      <p className="text-sm" data-testid="text-rent-quote">{q.quote.days} day{q.quote.days === 1 ? "" : "s"}: <strong>{money(q.quote.rentalTotal)}</strong>, charged at collection{q.quote.youngRenterFee > 0 ? `, including the young-renter fee of ${money(q.quote.youngRenterFee)}` : ""}. Deposit {money(q.quote.deposit)} held, released on return.{q.quote.milesAllowed > 0 ? ` ${q.quote.milesAllowed} miles included.` : ""}</p>
      {!q.ageKnown && <p className="text-xs text-muted-foreground" data-testid="text-rent-age-unknown">Under 25, a young-renter fee of $25 a day is added once you enter your date of birth.</p>}
      {!q.available && <p className="text-sm text-destructive">This car is already booked for some of those days.</p>}
      {me?.rules && <p className="text-xs text-muted-foreground" data-testid="text-rent-rules">{me.rules}</p>}
      {onFile && (
        <p className={`text-xs ${onFile.recordStatus === "refused" ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-rent-record">
          {RECORD_WORDS[onFile.recordStatus]}{onFile.recordStatus === "refused" && onFile.recordNote ? ` ${onFile.recordNote}` : ""}
        </p>
      )}
      <Input placeholder={onFile ? `Driving licence number (on file: ${onFile.licenceNumber})` : "Driving licence number"} value={licenceNumber} onChange={(e) => setLicenceNumber(e.target.value)} data-testid="input-rent-licence" />
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-muted-foreground">Date of birth
          <Input type="date" value={facts.dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} data-testid="input-rent-dob" />
        </label>
        <label className="text-xs text-muted-foreground">Licence issued
          <Input type="date" value={facts.licenceIssuedOn} onChange={(e) => setLicenceIssuedOn(e.target.value)} data-testid="input-rent-licence-issued" />
        </label>
        <label className="text-xs text-muted-foreground">Licence expires
          <Input type="date" value={facts.licenceExpiresOn} onChange={(e) => setLicenceExpiresOn(e.target.value)} data-testid="input-rent-licence-expires" />
        </label>
      </div>
      <ObjectUploader maxNumberOfFiles={1} onGetUploadParameters={uploadTarget} onComplete={(r) => { const u = r.successful[0]?.uploadURL; if (u) setLicenceImageUrl(new URL(u, window.location.origin).pathname); }} buttonClassName="w-full border rounded-md py-2 text-sm">
        <span data-testid="button-rent-upload-licence">{licenceImageUrl ? "Licence photo added ✓" : onFile?.licenceImageUrl ? "Licence photo on file ✓ (tap to replace)" : "Add a photo of your licence"}</span>
      </ObjectUploader>
      <Button className="w-full" disabled={!q.available || !facts.licenceNumber || !facts.licenceImageUrl || !facts.dateOfBirth || !facts.licenceIssuedOn || !facts.licenceExpiresOn || (onFile?.recordStatus === "refused" && !licenceNumber) || request.isPending} onClick={() => request.mutate()} data-testid="button-request-rental">
        {request.isPending ? "Requesting…" : "Request this rental"}
      </Button>
    </div>
  );
}

function MyRentals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rentals, isLoading } = useQuery<MyRental[]>({ queryKey: ["/api/rent/bookings"] });
  const cancel = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/rent/bookings/${id}/cancel`, {})).json(),
    onSuccess: () => { toast({ title: "Rental cancelled", description: "Nothing was charged." }); queryClient.invalidateQueries({ queryKey: ["/api/rent/bookings"] }); },
    onError: (e: Error) => toast({ title: "Could not cancel", description: e.message, variant: "destructive" }),
  });
  if (isLoading) return <div className="p-4"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (!rentals?.length) return <p className="p-4 text-sm text-muted-foreground" data-testid="text-no-rentals">No rentals yet.</p>;
  return (
    <div className="px-4 pt-4 space-y-3">
      {rentals.map((r) => (
        <Card key={r.id} data-testid={`card-my-rental-${r.id}`}>
          <CardContent className="p-4 space-y-1">
            <p className="font-semibold">{r.car.year} {r.car.make} {r.car.model}</p>
            <p className="text-xs text-muted-foreground">{when(r.startsAt)} → {when(r.endsAt)} · {r.days} day{r.days === 1 ? "" : "s"} · {money(r.rentalTotal)}</p>
            <p className="text-sm" data-testid={`text-rental-status-${r.id}`}>{RENTAL_STATUS_WORDS[r.status] ?? r.status}</p>
            {r.status === "collected" && new Date(r.endsAt).getTime() < Date.now() && (
              <p className="text-xs text-destructive" data-testid={`text-rental-overdue-${r.id}`}>This car was due back at {when(r.endsAt)}. Every hour late is charged, and the car may be stopped remotely. Bring it back now.</p>
            )}
            {r.settlement && (r.status === "closed" || r.status === "returned") && (
              <p className="text-xs text-muted-foreground">Extras {money(r.settlement.extrasTotal)} · deposit released {money(r.settlement.depositReleased)}{r.damageNote ? ` · damage: ${r.damageNote}` : ""}</p>
            )}
            {(r.status === "requested" || r.status === "confirmed") && (
              <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)} data-testid={`button-cancel-rental-${r.id}`}>Cancel (free)</Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
