/**
 * The fleet desk's cars (PG Ride Fleet Management Accounts Plan, slice 2):
 * each car with its photo, plate, papers and their expiry dates, PG Ride's
 * check (waiting, approved, or sent back with a note), why it is not ready,
 * and which driver has it (slice 3). The owner or a manager adds a car with
 * photos and papers; every rule comes from the server (shared/fleet.ts).
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ObjectUploader } from "@/components/ObjectUploader";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from "@shared/vehicleTypes";
import { MIN_PHOTOS } from "@shared/rental";
import { refreshFleet, useFleetDrivers } from "@/components/portal/FleetDrivers";

interface FleetCarRow {
  id: string; make: string; model: string; year: number; color: string; seats: number; vehicleType: string; licensePlate: string; vin: string | null;
  photos: string[]; registrationDocUrl: string | null; insuranceDocUrl: string | null; inspectionDocUrl: string | null;
  inspectionExpires: string | null; registrationExpires: string | null; insuranceExpires: string | null;
  reviewStatus: "pending" | "approved" | "rejected"; reviewNote: string | null; status: "parked" | "ready"; parkedReason: string | null;
  driverUserId: string | null; driverName?: string | null; problems: string[]; warnings: Array<{ document: string; daysLeft: number }>;
}

const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}
async function uploadTarget() {
  const res = await apiRequest("POST", "/api/objects/upload?store=db", {});
  const { uploadURL } = await res.json();
  return { method: "PUT" as const, url: uploadURL };
}
const pathOf = (u: string) => new URL(u, window.location.origin).pathname;

function DocUpload({ onChange, children }: { onChange: (v: string) => void; children: ReactNode }) {
  return (
    <ObjectUploader maxNumberOfFiles={1} onGetUploadParameters={uploadTarget} onComplete={(r) => { const u = r.successful[0]?.uploadURL; if (u) onChange(pathOf(u)); }} buttonClassName="w-full border rounded-md py-2 text-xs">
      {children}
    </ObjectUploader>
  );
}

export function FleetCarsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { data: cars, isLoading } = useQuery<FleetCarRow[]>({ queryKey: ["/api/fleet", orgId, "cars"], queryFn: () => json("GET", `/api/fleet/${orgId}/cars`), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2" data-testid="fleet-cars">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Cars</p>
        {canManage && <Button size="sm" variant={adding ? "outline" : "default"} onClick={() => setAdding((v) => !v)} data-testid="button-fleet-add-car">{adding ? "Close" : "Add a car"}</Button>}
      </div>
      {adding && <AddCarForm orgId={orgId} onDone={() => setAdding(false)} />}
      {isLoading && <p className="text-xs text-muted-foreground">Loading cars…</p>}
      {!isLoading && (cars?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-cars">No cars yet. Add one with its photos and papers; PG Ride checks them before it carries riders.</p>}
      {cars?.map((c) => (
        <div key={c.id} className="border rounded-md p-3 flex gap-3" data-testid={`row-fleet-car-${c.id}`}>
          {c.photos[0] ? <img src={c.photos[0]} alt="" className="w-20 h-14 object-cover rounded" /> : <div className="w-20 h-14 rounded bg-muted" />}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{c.year} {c.make} {c.model}</span>
              <span className="text-xs text-muted-foreground">{c.licensePlate} · {c.color} · {c.seats} seats</span>
              <Badge variant={c.status === "ready" ? "default" : "secondary"} data-testid={`badge-fleet-car-${c.id}`}>{c.status}</Badge>
              <Badge variant="outline">{c.reviewStatus === "approved" ? "papers checked" : c.reviewStatus === "rejected" ? "papers sent back" : "waiting for PG Ride"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Inspection {day(c.inspectionExpires)} · registration {day(c.registrationExpires)} · insurance {day(c.insuranceExpires)} · driver {c.driverUserId ? (c.driverName ?? "assigned") : "none"}</p>
            {canManage && <CarDriverControl orgId={orgId} car={c} />}
            {c.reviewNote && c.reviewStatus === "rejected" && <p className="text-xs text-destructive" data-testid={`text-fleet-car-note-${c.id}`}>PG Ride's note: {c.reviewNote}</p>}
            {c.problems.length > 0 && c.reviewStatus !== "rejected" && <p className="text-xs text-muted-foreground">{c.problems.join(" ")}</p>}
            {c.warnings.map((w) => <p key={w.document} className="text-xs text-amber-700" data-testid={`text-fleet-car-warning-${c.id}`}>{w.document} expires in {w.daysLeft} days.</p>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Give the car to one of the fleet's approved drivers, or take it back (slice 3). */
function CarDriverControl({ orgId, car }: { orgId: string; car: FleetCarRow }) {
  const { toast } = useToast();
  const { data } = useFleetDrivers(orgId);
  const [driverUserId, setDriverUserId] = useState("");
  const free = (data?.drivers ?? []).filter((d) => d.approvedByPgRide && !d.car);
  const assign = useMutation({
    mutationFn: () => json("POST", `/api/fleet/${orgId}/cars/${car.id}/assign`, { driverUserId }),
    onSuccess: () => { toast({ title: "Car given to the driver", description: "It shows as their car to riders and dispatch." }); setDriverUserId(""); refreshFleet(orgId); },
    onError: (e: Error) => toast({ title: "Could not give the car", description: e.message, variant: "destructive" }),
  });
  const takeBack = useMutation({
    mutationFn: () => json("POST", `/api/fleet/${orgId}/cars/${car.id}/take-back`),
    onSuccess: () => { toast({ title: "Car taken back", description: "It is no longer the driver's car." }); refreshFleet(orgId); },
    onError: (e: Error) => toast({ title: "Could not take the car back", description: e.message, variant: "destructive" }),
  });
  if (car.driverUserId) {
    return (
      <Button size="sm" variant="outline" disabled={takeBack.isPending}
        onClick={() => { if (window.confirm(`Take the ${car.make} ${car.model} back from ${car.driverName ?? "the driver"}?`)) takeBack.mutate(); }}
        data-testid={`button-fleet-take-back-${car.id}`}>Take back</Button>
    );
  }
  if (car.status !== "ready") return null;
  return (
    <div className="flex flex-wrap gap-2 items-center" data-testid={`fleet-car-assign-${car.id}`}>
      <select className="border rounded-md h-9 px-2 text-sm bg-background" value={driverUserId} onChange={(e) => setDriverUserId(e.target.value)} data-testid={`select-fleet-car-driver-${car.id}`}>
        <option value="">{free.length ? "Choose a driver" : "No approved driver without a car"}</option>
        {free.map((d) => <option key={d.userId} value={d.userId}>{d.name}</option>)}
      </select>
      <Button size="sm" disabled={!driverUserId || assign.isPending} onClick={() => assign.mutate()} data-testid={`button-fleet-assign-car-${car.id}`}>Give to driver</Button>
    </div>
  );
}

function AddCarForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ make: "", model: "", year: "", color: "", seats: "5", vehicleType: "standard", licensePlate: "", vin: "", inspectionExpires: "", registrationExpires: "", insuranceExpires: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [docs, setDocs] = useState<{ registrationDocUrl?: string; insuranceDocUrl?: string; inspectionDocUrl?: string }>({});
  const save = useMutation({
    mutationFn: () => json<FleetCarRow>("POST", `/api/fleet/${orgId}/cars`, { ...f, year: Number(f.year), seats: Number(f.seats), photos, ...docs }),
    onSuccess: (c) => {
      toast({ title: "Car sent to PG Ride", description: c.problems.length ? c.problems.join(" ") : "PG Ride checks the papers; the car is ready once they are approved." });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet", orgId, "cars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet", orgId] });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Could not add the car", description: e.message, variant: "destructive" }),
  });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">{label}<Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-fleet-car-${k}`} /></label>
  );
  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30" data-testid="form-fleet-car">
      <div className="grid grid-cols-2 gap-2">
        {field("make", "Make")}{field("model", "Model")}{field("year", "Model year", "number")}{field("color", "Colour")}{field("seats", "Seats (with the driver)", "number")}
        <label className="text-xs text-muted-foreground">Class
          <select className="w-full border rounded-md h-9 px-2 text-sm bg-background" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} data-testid="select-fleet-car-class">
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t] ?? t}</option>)}
          </select>
        </label>
        {field("licensePlate", "Plate")}{field("vin", "VIN (17 characters)")}
        {field("inspectionExpires", "Inspection expires", "date")}{field("registrationExpires", "Registration expires", "date")}{field("insuranceExpires", "Insurance expires", "date")}
      </div>
      <ObjectUploader maxNumberOfFiles={8} onGetUploadParameters={uploadTarget} onComplete={(r) => setPhotos([...photos, ...r.successful.map((x) => pathOf(x.uploadURL))])} buttonClassName="w-full border rounded-md py-2 text-sm">
        <span data-testid="button-fleet-car-photos">Add photos of the car (at least {MIN_PHOTOS}) ({photos.length} added)</span>
      </ObjectUploader>
      <div className="grid grid-cols-3 gap-2">
        <DocUpload onChange={(v) => setDocs({ ...docs, registrationDocUrl: v })}><span data-testid="button-fleet-car-doc-registration">{docs.registrationDocUrl ? "registration ✓" : "Add registration card"}</span></DocUpload>
        <DocUpload onChange={(v) => setDocs({ ...docs, insuranceDocUrl: v })}><span data-testid="button-fleet-car-doc-insurance">{docs.insuranceDocUrl ? "insurance ✓" : "Add insurance card"}</span></DocUpload>
        <DocUpload onChange={(v) => setDocs({ ...docs, inspectionDocUrl: v })}><span data-testid="button-fleet-car-doc-inspection">{docs.inspectionDocUrl ? "inspection ✓" : "Add inspection certificate"}</span></DocUpload>
      </div>
      <p className="text-xs text-muted-foreground">The insurance must be commercial or rideshare cover. PG Ride checks the papers before the car carries riders, and the car comes off the road the day a paper lapses.</p>
      <Button className="w-full" disabled={save.isPending || !f.make || !f.model || !f.year || !f.color || !f.licensePlate} onClick={() => save.mutate()} data-testid="button-fleet-car-save">{save.isPending ? "Sending…" : "Send to PG Ride to check"}</Button>
    </div>
  );
}
