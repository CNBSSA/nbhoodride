/**
 * The fleet desk's drivers (PG Ride Fleet Management Accounts Plan, slice 3):
 * each driver's name, whether PG Ride has approved them as a driver, and the
 * car they have — never a rider's name, phone or address. The owner or a
 * manager invites a driver by email (a link they accept themselves) and may
 * remove one; PG Ride alone approves drivers. Every rule is the server's
 * (shared/fleet.ts, server/fleet/drivers.ts).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface FleetDriverRow {
  userId: string; name: string; approvedByPgRide: boolean; approvalStatus: string | null; approvalText: string;
  car: { id: string; label: string; status: string } | null;
}
export interface FleetDriversView { drivers: FleetDriverRow[]; invitations: Array<{ id: string; email: string; expiresAt: string }> }

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export const fleetDriversKey = (orgId: string) => ["/api/fleet", orgId, "drivers"];
export function useFleetDrivers(orgId: string) {
  return useQuery<FleetDriversView>({ queryKey: fleetDriversKey(orgId), queryFn: () => json("GET", `/api/fleet/${orgId}/drivers`), refetchInterval: 30_000, refetchOnWindowFocus: true });
}
export function refreshFleet(orgId: string) {
  queryClient.invalidateQueries({ queryKey: fleetDriversKey(orgId) });
  queryClient.invalidateQueries({ queryKey: ["/api/fleet", orgId, "cars"] });
  queryClient.invalidateQueries({ queryKey: ["/api/fleet", orgId] });
}

export function FleetDriversSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { toast } = useToast();
  const { data, isLoading } = useFleetDrivers(orgId);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => json<{ link: string; email: string; emailSent: boolean }>("POST", `/api/fleet/${orgId}/drivers`, { email }),
    onSuccess: (r) => {
      setLink(r.link); setEmail("");
      toast({ title: "Driver invited", description: r.emailSent ? `An invitation went to ${r.email}. You can also send them the link below.` : `Send ${r.email} the link below; the email could not be sent.` });
      refreshFleet(orgId);
    },
    onError: (e: Error) => toast({ title: "Could not invite them", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => json("DELETE", `/api/fleet/${orgId}/drivers/${userId}`),
    onSuccess: () => { toast({ title: "Driver removed", description: "Their car, if they had one, is back with the fleet. They keep their PG Ride account." }); refreshFleet(orgId); },
    onError: (e: Error) => toast({ title: "Could not remove them", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-2" data-testid="fleet-drivers">
      <p className="text-sm font-medium">Drivers</p>
      <p className="text-xs text-muted-foreground">PG Ride approves every driver, as it does any driver: a fleet invites them, and they finish PG Ride's driver application. A driver drives for one fleet at a time.</p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-9 flex-1 min-w-[12rem]" type="email" placeholder="The driver's email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-fleet-driver-email" />
          <Button size="sm" disabled={invite.isPending || !email.includes("@")} onClick={() => invite.mutate()} data-testid="button-fleet-invite-driver">{invite.isPending ? "Inviting…" : "Invite a driver"}</Button>
        </div>
      )}
      {link && <p className="text-xs break-all" data-testid="text-fleet-driver-link">Invitation link: {link}</p>}
      {isLoading && <p className="text-xs text-muted-foreground">Loading drivers…</p>}
      {!isLoading && (data?.drivers.length ?? 0) === 0 && <p className="text-sm text-muted-foreground" data-testid="text-fleet-no-drivers">No drivers yet.</p>}
      {data?.drivers.map((d) => (
        <div key={d.userId} className="border rounded-md p-3 flex items-center gap-2 flex-wrap" data-testid={`row-fleet-driver-${d.userId}`}>
          <span className="font-medium">{d.name}</span>
          <Badge variant={d.approvedByPgRide ? "default" : "outline"} data-testid={`badge-fleet-driver-${d.userId}`}>{d.approvalText}</Badge>
          <span className="text-xs text-muted-foreground">{d.car ? `Car: ${d.car.label}${d.car.status !== "ready" ? " (parked)" : ""}` : "No car"}</span>
          {canManage && (
            <Button size="sm" variant="outline" className="ml-auto" disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Remove ${d.name} from the fleet?${d.car ? " Their car is taken back first." : ""}`)) remove.mutate(d.userId); }}
              data-testid={`button-fleet-remove-driver-${d.userId}`}>Remove from fleet</Button>
          )}
        </div>
      ))}
      {(data?.invitations.length ?? 0) > 0 && (
        <div className="space-y-1" data-testid="fleet-driver-invitations">
          <p className="text-xs text-muted-foreground">Invited, not yet joined:</p>
          {data!.invitations.map((i) => <p key={i.id} className="text-xs">{i.email} · link works until {new Date(i.expiresAt).toISOString().slice(0, 10)}</p>)}
        </div>
      )}
    </div>
  );
}
