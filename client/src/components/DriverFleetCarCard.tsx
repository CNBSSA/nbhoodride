/**
 * "No car? Drive a PG Ride car" — for driver applicants and drivers
 * (Car Rental Master Plan, phase 3). Shows the driver's PG Ride car if they
 * have one or asked for one, and otherwise lets them ask for one by the week.
 * Only PG Ride's own cars are offered to drivers. Shown only while
 * RENTAL_ENABLED is on.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DRIVER_ASSIGNMENT_WORDS, money, type DriverAssignmentStatus } from "@shared/rental";

interface FleetCar { id: string; make: string; model: string; year: number; color: string; seats: number; photos: string[]; weeklyRent: string; pickupAddress: string | null }
interface MyCar {
  id: string; status: DriverAssignmentStatus; startsAt: string; endsAt: string; weeks: number; weeklyRent: string;
  paidThrough: string | null; paymentStatus: string; paymentError: string | null; car: FleetCar & { licensePlate?: string };
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—");
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function DriverFleetCarCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const start = new Date(Date.now() + 26 * 3600_000); start.setMinutes(0, 0, 0);
  const [from, setFrom] = useState(localInput(start));
  const [weeks, setWeeks] = useState("1");
  const { data: mine, isLoading } = useQuery<MyCar | null>({ queryKey: ["/api/driver/fleet-car"] });
  const fromIso = from ? new Date(from).toISOString() : "";
  const toIso = fromIso ? new Date(new Date(from).getTime() + Math.max(1, Number(weeks) || 1) * 7 * 86400_000).toISOString() : "";
  const { data: offer } = useQuery<{ cars: FleetCar[]; terms: string; maxWeeks: number }>({
    queryKey: [`/api/driver/fleet-cars?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`],
    enabled: open && !mine && !!fromIso,
  });
  const ask = useMutation({
    mutationFn: async (carId: string) => (await apiRequest("POST", "/api/driver/fleet-car/request", { carId, startsAt: fromIso, weeks: Number(weeks) })).json(),
    onSuccess: () => { toast({ title: "Asked for the car", description: "PG Ride confirms it shortly. Nothing is charged until you collect it." }); setOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/driver/fleet-car"] }); },
    onError: (e: Error) => toast({ title: "Could not ask for the car", description: e.message, variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/driver/fleet-car/cancel", {})).json(),
    onSuccess: () => { toast({ title: "Cancelled", description: "Nothing was charged." }); queryClient.invalidateQueries({ queryKey: ["/api/driver/fleet-car"] }); },
    onError: (e: Error) => toast({ title: "Could not cancel", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  if (mine) {
    return (
      <Card data-testid="card-my-fleet-car">
        <CardContent className="p-4 space-y-1">
          <p className="font-semibold flex items-center gap-2"><Car className="w-4 h-4" /> Your PG Ride car</p>
          <p className="text-sm">{mine.car.year} {mine.car.make} {mine.car.model} · {mine.car.color}{mine.car.licensePlate ? ` · ${mine.car.licensePlate}` : ""}</p>
          <p className="text-sm" data-testid="text-fleet-car-status">{DRIVER_ASSIGNMENT_WORDS[mine.status] ?? mine.status}</p>
          <p className="text-xs text-muted-foreground">{money(mine.weeklyRent)} a week · {day(mine.startsAt)} → {day(mine.endsAt)}{mine.status === "active" ? ` · rent paid to ${day(mine.paidThrough)}` : ""}{mine.car.pickupAddress ? ` · ${mine.car.pickupAddress}` : ""}</p>
          {mine.paymentStatus === "due" && <p className="text-xs text-destructive">This week's rent has not gone through. Update your card; PG Ride will retry it.</p>}
          {(mine.status === "requested" || mine.status === "assigned") && (
            <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()} data-testid="button-cancel-fleet-car">Cancel (free)</Button>
          )}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="card-fleet-car-offer">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">No car? Drive a PG Ride car</p>
            <p className="text-sm text-muted-foreground">Rent one of PG Ride's cars by the week and drive it on PG Ride.</p>
          </div>
          <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setOpen((v) => !v)} data-testid="button-driver-rent-car">{open ? "Close" : "See cars"}</Button>
        </div>
        {open && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">Collect<Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-fleet-from" /></label>
              <label className="text-xs text-muted-foreground">Weeks<Input type="number" min={1} max={offer?.maxWeeks ?? 12} value={weeks} onChange={(e) => setWeeks(e.target.value)} data-testid="input-fleet-weeks" /></label>
            </div>
            {offer?.terms && <p className="text-xs text-muted-foreground">{offer.terms}</p>}
            {!offer && <Loader2 className="w-4 h-4 animate-spin" />}
            {offer && offer.cars.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-fleet-cars">No PG Ride car is free from then. Try another start.</p>}
            {offer?.cars.map((c) => (
              <div key={c.id} className="border rounded-md p-3 flex items-center justify-between gap-2" data-testid={`row-fleet-offer-${c.id}`}>
                <div>
                  <p className="font-medium text-sm">{c.year} {c.make} {c.model}</p>
                  <p className="text-xs text-muted-foreground">{c.color} · {c.seats} seats · {money(c.weeklyRent)} a week{c.pickupAddress ? ` · ${c.pickupAddress}` : ""}</p>
                </div>
                <Button size="sm" disabled={ask.isPending} onClick={() => ask.mutate(c.id)} data-testid={`button-ask-fleet-car-${c.id}`}>Ask for it</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
