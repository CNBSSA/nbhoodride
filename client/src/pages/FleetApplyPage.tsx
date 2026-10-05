/**
 * Open a fleet account (PG Ride Fleet Management Accounts Plan, slice 1).
 * Reached from Profile's "Own cars? Open a fleet account"; shown only while
 * FLEET_ENABLED is on. The investor gives the business's details; PG Ride
 * checks them and approves the fleet, and the fleet desk opens at /org.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlags, useStripeConfig } from "@/hooks/useStripeConfig";
import { useAuth } from "@/hooks/useAuth";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, FLEET_TERMS_SENTENCE } from "@shared/fleet";

export default function FleetApplyPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { fleetEnabled } = useFeatureFlags();
  const { isLoading: flagsLoading } = useStripeConfig();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: mine } = useQuery<Array<{ id: string; name: string; status: string; role: string }>>({ queryKey: ["/api/fleet/mine"], enabled: fleetEnabled && isAuthenticated, retry: false });
  const [f, setF] = useState({ name: "", legalName: "", ein: "", businessType: "llc", contactPhone: "" });
  const [problems, setProblems] = useState<string[]>([]);
  const apply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fleet/apply", f);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setProblems(data?.problems ?? []); throw new Error(data?.message || `${res.status}`); }
      return data;
    },
    onSuccess: (org: any) => {
      toast({ title: "Application sent", description: "PG Ride checks it. Add how the fleet is paid on your fleet desk meanwhile." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/mine"] });
      setLocation(`/org?org=${org.id}`);
    },
    onError: (e: Error) => toast({ title: "Could not send the application", description: e.message, variant: "destructive" }),
  });

  if (flagsLoading) return <div className="p-4 text-sm text-muted-foreground" data-testid="fleet-apply-loading">Loading…</div>;
  if (!fleetEnabled) {
    return (
      <div className="min-h-screen bg-background p-4" data-testid="fleet-apply-off">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/profile")} data-testid="button-fleet-apply-back"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <p className="mt-6 text-sm text-muted-foreground">Fleet accounts are not open yet.</p>
      </div>
    );
  }
  if (authLoading) return <div className="p-4 text-sm text-muted-foreground" data-testid="fleet-apply-loading">Loading…</div>;
  // Signed out (work order #452): the page is reachable before sign-in, as
  // /org/apply is, and says what to do first instead of showing a form whose
  // submission could only fail.
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background p-8 max-w-xl mx-auto space-y-4" data-testid="fleet-apply-signed-out">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <h1 className="text-2xl font-bold">Open a fleet account</h1>
        <p className="text-sm text-muted-foreground">Put your cars on PG Ride with PG Ride drivers. {FLEET_TERMS_SENTENCE}</p>
        <p className="text-sm">First create your own PG Ride account (a minute), then come back here to apply for the fleet.</p>
        <div className="flex gap-2">
          <Link href="/signup"><Button data-testid="button-fleet-apply-signup">Create an account</Button></Link>
          <Link href="/login"><Button variant="outline" data-testid="button-fleet-apply-login">I have one: sign in</Button></Link>
        </div>
      </div>
    );
  }
  const field = (k: keyof typeof f, label: string, placeholder = "") => (
    <label className="text-xs text-muted-foreground block">{label}
      <Input value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-fleet-${k}`} />
    </label>
  );
  return (
    <div className="min-h-screen bg-background pb-24" data-testid="fleet-apply-page">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/profile")} data-testid="button-fleet-apply-back"><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-lg font-semibold">Open a fleet account</h1>
      </div>
      <div className="px-4 pt-4 space-y-4 max-w-xl mx-auto">
        <p className="text-sm">Put your cars on PG Ride with PG Ride drivers. {FLEET_TERMS_SENTENCE}</p>
        {(mine?.length ?? 0) > 0 && (
          <div className="border rounded-md p-3 space-y-2" data-testid="fleet-apply-existing">
            <p className="text-sm">You already have {mine!.length === 1 ? `a fleet: ${mine![0].name} (${mine![0].status === "active" ? "approved" : mine![0].status})` : `${mine!.length} fleets`}.</p>
            <Button size="sm" variant="outline" onClick={() => setLocation(`/org?org=${mine![0].id}`)} data-testid="button-fleet-open-desk">Open the fleet desk</Button>
          </div>
        )}
        {field("name", "Fleet name (what drivers see)", "Bowie Motors")}
        {field("legalName", "Business legal name, as registered", "Bowie Motors LLC")}
        <div className="grid grid-cols-2 gap-2">
          {field("ein", "EIN", "12-3456789")}
          <label className="text-xs text-muted-foreground block">Kind of business
            <Select value={f.businessType} onValueChange={(v) => setF({ ...f, businessType: v })}>
              <SelectTrigger data-testid="select-fleet-business-type"><SelectValue /></SelectTrigger>
              <SelectContent>{BUSINESS_TYPES.map((t) => <SelectItem key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        {field("contactPhone", "Phone PG Ride can call", "(240) 555-0100")}
        <p className="text-xs text-muted-foreground">PG Ride checks the business before the fleet opens. You will need commercial or rideshare insurance on every car, and a payout account in the business's name.</p>
        {problems.length > 0 && <ul className="text-sm text-destructive list-disc pl-5" data-testid="fleet-apply-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button className="w-full" disabled={apply.isPending || !f.name.trim() || !f.legalName.trim() || !f.ein.trim() || !f.contactPhone.trim()} onClick={() => apply.mutate()} data-testid="button-fleet-apply">{apply.isPending ? "Sending…" : "Send the application"}</Button>
      </div>
    </div>
  );
}
