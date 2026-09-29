/**
 * PG Ride's check of a fleet's cars (Fleet Management Accounts Plan, slice
 * 2), inside the fleet's detail in Admin → Organizations: each car with its
 * photos and papers to open, why it is not ready, and "Papers are right" or
 * "Send back" with a note the fleet sees.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface CarRow {
  id: string; make: string; model: string; year: number; color: string; seats: number; licensePlate: string; vin: string | null; photos: string[];
  registrationDocUrl: string | null; insuranceDocUrl: string | null; inspectionDocUrl: string | null;
  inspectionExpires: string | null; registrationExpires: string | null; insuranceExpires: string | null;
  reviewStatus: string; reviewNote: string | null; status: string; problems: string[]; driverUserId: string | null;
}

const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");
async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function FleetCarsReview({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const { data: cars = [] } = useQuery<CarRow[]>({ queryKey: ["/api/admin/fleets", orgId, "cars"], queryFn: () => json("GET", `/api/admin/fleets/${orgId}/cars`), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useMutation({
    mutationFn: ({ carId, decision }: { carId: string; decision: "approve" | "reject" }) => json<CarRow>("POST", `/api/admin/fleets/${orgId}/cars/${carId}/review`, { decision, note: notes[carId] ?? "" }),
    onSuccess: (c) => {
      toast({ title: c.reviewStatus === "approved" ? "Papers accepted" : "Sent back", description: c.reviewStatus === "approved" ? (c.status === "ready" ? "The car is ready for a driver." : c.problems.join(" ")) : "The fleet is shown your note." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fleets", orgId, "cars"] });
    },
    onError: (e: Error) => toast({ title: "Could not record the check", description: e.message, variant: "destructive" }),
  });
  const waiting = cars.filter((c) => c.reviewStatus === "pending").length;
  return (
    <Card data-testid={`fleet-cars-review-${orgId}`}>
      <CardHeader><CardTitle className="text-base">Cars</CardTitle><CardDescription>{cars.length} cars, {waiting} waiting for a check. Check the registration, the commercial or rideshare insurance and the inspection against the plate and VIN before approving.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {cars.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-cars-admin">The fleet has not added a car yet.</p>}
        {cars.map((c) => (
          <div key={c.id} className="border rounded-md p-3 space-y-1" data-testid={`row-admin-fleet-car-${c.id}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{c.year} {c.make} {c.model} ({c.licensePlate})</span>
              <Badge variant={c.status === "ready" ? "default" : "secondary"}>{c.status}</Badge>
              <Badge variant="outline">{c.reviewStatus}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">VIN {c.vin ?? "—"} · {c.color} · {c.seats} seats · inspection {day(c.inspectionExpires)} · registration {day(c.registrationExpires)} · insurance {day(c.insuranceExpires)} · {c.photos.length} photos · driver {c.driverUserId ? "assigned" : "none"}</p>
            <p className="text-xs">
              {c.photos.map((p, i) => <a key={p} className="underline mr-2" href={p} target="_blank" rel="noreferrer">photo {i + 1}</a>)}
              {c.registrationDocUrl && <a className="underline mr-2" href={c.registrationDocUrl} target="_blank" rel="noreferrer">registration</a>}
              {c.insuranceDocUrl && <a className="underline mr-2" href={c.insuranceDocUrl} target="_blank" rel="noreferrer">insurance</a>}
              {c.inspectionDocUrl && <a className="underline mr-2" href={c.inspectionDocUrl} target="_blank" rel="noreferrer">inspection</a>}
            </p>
            {c.problems.length > 0 && <p className="text-xs text-muted-foreground">{c.problems.join(" ")}</p>}
            {c.reviewNote && c.reviewStatus === "rejected" && <p className="text-xs text-destructive">Sent back: {c.reviewNote}</p>}
            {c.reviewStatus === "pending" && (
              <div className="flex flex-wrap gap-2 items-center pt-1">
                <Input className="h-8 max-w-xs" placeholder="Note to the fleet (needed to send back)" value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} data-testid={`input-fleet-car-note-${c.id}`} />
                <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ carId: c.id, decision: "approve" })} data-testid={`button-approve-fleet-car-${c.id}`}>Papers are right</Button>
                <Button size="sm" variant="outline" disabled={review.isPending || !(notes[c.id] ?? "").trim()} onClick={() => review.mutate({ carId: c.id, decision: "reject" })} data-testid={`button-sendback-fleet-car-${c.id}`}>Send back</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
