/**
 * The desk of an account that applied for itself and is not approved yet
 * (self-serve organization applications, 2026-09-28): where the application
 * stands, PG Ride's note when it was sent back, and the owner's way to
 * correct it and send it again. Booking is closed until PG Ride approves.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORG_STATUS_WORDS, type OrgApplicationStatus } from "@shared/orgApplication";

interface Detail { status: string; application: { legalName: string; businessType: string; ein: string; reviewNote: string | null } | null }

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function ApplicationStatus({ orgId, status, isOwner }: { orgId: string; status: string; isOwner: boolean }) {
  const { toast } = useToast();
  const { data } = useQuery<Detail>({ queryKey: ["/api/org", orgId, "detail"], queryFn: () => json("GET", `/api/org/${orgId}`) });
  const [legalName, setLegalName] = useState("");
  const [ein, setEin] = useState("");
  const send = useMutation({
    mutationFn: () => json("PATCH", `/api/org/${orgId}/application`, { ...(legalName ? { legalName } : {}), ...(ein ? { ein } : {}) }),
    onSuccess: () => { toast({ title: "Sent to PG Ride again", description: "You'll see here when it is checked." }); queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "detail"] }); queryClient.invalidateQueries({ queryKey: ["/api/org/mine"] }); },
    onError: (e: Error) => toast({ title: "Could not send it", description: e.message, variant: "destructive" }),
  });
  const words = ORG_STATUS_WORDS[status as OrgApplicationStatus] ?? status;
  return (
    <section className="border rounded-xl p-4 space-y-2 bg-card" data-testid="portal-application">
      <p className="font-medium" data-testid="text-portal-application-status">{words}</p>
      {data?.application && <p className="text-sm text-muted-foreground">{data.application.legalName} · EIN {data.application.ein}</p>}
      {status === "pending" && <p className="text-sm text-muted-foreground">PG Ride checks the organization, usually within a day. Booking opens when it is approved; you can add people and billing meanwhile.</p>}
      {status === "rejected" && data?.application?.reviewNote && <p className="text-sm text-destructive" data-testid="text-portal-review-note">PG Ride's note: {data.application.reviewNote}</p>}
      {status === "rejected" && isOwner && (
        <div className="space-y-2 pt-1" data-testid="form-org-resubmit">
          <Input className="h-9" placeholder={`Legal name (on file: ${data?.application?.legalName ?? "—"}); leave blank to keep it`} value={legalName} onChange={(e) => setLegalName(e.target.value)} data-testid="input-org-resubmit-legal-name" />
          <Input className="h-9" placeholder={`EIN (on file: ${data?.application?.ein ?? "—"}); leave blank to keep it`} value={ein} onChange={(e) => setEin(e.target.value)} data-testid="input-org-resubmit-ein" />
          <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()} data-testid="button-org-resubmit">Correct and send again</Button>
        </div>
      )}
    </section>
  );
}
