/**
 * Open a PG Ride business account (self-serve organization applications,
 * 2026-09-28). Reached from the landing page, the business sign-in, Profile
 * and the portal's empty state; shown only while COMMERCIAL_ENABLED is on.
 * Signed out, it says to create a PG Ride account first. The applicant
 * gives the organization's details; PG Ride checks them and approves, and
 * the desk opens at /org.
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
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags, useStripeConfig } from "@/hooks/useStripeConfig";
import { CATEGORY_LABELS, COMMERCIAL_CATEGORIES, type CommercialCategory } from "@shared/commercial";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, ORG_APPLY_SENTENCE } from "@shared/orgApplication";
import { BRAND } from "@shared/branding";

export default function OrgApplyPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { commercialEnabled } = useFeatureFlags();
  const { isLoading: flagsLoading } = useStripeConfig();
  const { data: mine } = useQuery<Array<{ organization: { id: string; name: string; status: string; category: string }; role: string }>>({ queryKey: ["/api/org/mine"], enabled: isAuthenticated && commercialEnabled, retry: false });
  const [f, setF] = useState({ name: "", category: "business" as CommercialCategory, legalName: "", ein: "", businessType: "llc", contactPhone: "", address: "" });
  const [problems, setProblems] = useState<string[]>([]);
  const apply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/org/apply", f);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setProblems(data?.problems ?? []); throw new Error(data?.message || `${res.status}`); }
      return data;
    },
    onSuccess: (org: any) => {
      toast({ title: "Application sent", description: "PG Ride checks it and opens your desk. You'll see its status there." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/mine"] });
      setLocation(`/org?org=${org.id}`);
    },
    onError: (e: Error) => toast({ title: "Could not send the application", description: e.message, variant: "destructive" }),
  });

  if (flagsLoading || authLoading) return <div className="p-4 text-sm text-muted-foreground" data-testid="org-apply-loading">Loading…</div>;
  if (!commercialEnabled) {
    return (
      <div className="min-h-screen bg-background p-4" data-testid="org-apply-off">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <p className="mt-6 text-sm text-muted-foreground">Business accounts are not open yet.</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background p-8 max-w-xl mx-auto space-y-4" data-testid="org-apply-signed-out">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <h1 className="text-2xl font-bold">{BRAND.appName} for Business</h1>
        <p className="text-sm text-muted-foreground">{ORG_APPLY_SENTENCE}</p>
        <p className="text-sm">First create your own {BRAND.appName} account (a minute), then come back here to apply for the organization.</p>
        <div className="flex gap-2">
          <Link href="/signup"><Button data-testid="button-org-apply-signup">Create an account</Button></Link>
          <Link href="/org/login"><Button variant="outline" data-testid="button-org-apply-login">I have one: sign in</Button></Link>
        </div>
      </div>
    );
  }
  const waiting = (mine ?? []).filter((m) => m.organization.category !== "fleet" && (m.organization.status === "pending" || m.organization.status === "rejected"));
  const field = (k: "name" | "legalName" | "ein" | "contactPhone" | "address", label: string, placeholder = "") => (
    <label className="text-xs text-muted-foreground block">{label}
      <Input value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-org-apply-${k}`} />
    </label>
  );
  return (
    <div className="min-h-screen bg-background pb-24" data-testid="org-apply-page">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="button-org-apply-back"><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-lg font-semibold">Open a business account</h1>
      </div>
      <div className="px-4 pt-4 space-y-4 max-w-xl mx-auto">
        <p className="text-sm">{ORG_APPLY_SENTENCE}</p>
        {waiting.length > 0 && (
          <div className="border rounded-md p-3 space-y-2" data-testid="org-apply-existing">
            <p className="text-sm">Your application for <strong>{waiting[0].organization.name}</strong> is {waiting[0].organization.status === "pending" ? "waiting for PG Ride" : "sent back: see the note on your desk"}.</p>
            <Button size="sm" variant="outline" onClick={() => setLocation(`/org?org=${waiting[0].organization.id}`)} data-testid="button-org-apply-open-desk">Open the desk</Button>
          </div>
        )}
        {field("name", "Account name (what your staff see)", "Largo Dialysis Center")}
        <label className="text-xs text-muted-foreground block">Kind of organization
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v as CommercialCategory })}>
            <SelectTrigger data-testid="select-org-apply-category"><SelectValue /></SelectTrigger>
            <SelectContent>{COMMERCIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {field("legalName", "Legal name, as registered", "Largo Dialysis Center LLC")}
        <div className="grid grid-cols-2 gap-2">
          {field("ein", "EIN", "12-3456789")}
          <label className="text-xs text-muted-foreground block">Kind of business
            <Select value={f.businessType} onValueChange={(v) => setF({ ...f, businessType: v })}>
              <SelectTrigger data-testid="select-org-apply-business-type"><SelectValue /></SelectTrigger>
              <SelectContent>{BUSINESS_TYPES.map((t) => <SelectItem key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        {field("contactPhone", "Phone PG Ride can call", "(240) 555-0100")}
        {field("address", "Address (where rides usually start)", "1 Main St, Largo, MD")}
        <p className="text-xs text-muted-foreground">PG Ride checks the organization before the desk opens. Medical transportation accounts carry a facility fee per completed job; every account is billed weekly.</p>
        {problems.length > 0 && <ul className="text-sm text-destructive list-disc pl-5" data-testid="org-apply-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <Button className="w-full" disabled={apply.isPending || !f.name.trim() || !f.legalName.trim() || !f.ein.trim() || !f.contactPhone.trim()} onClick={() => apply.mutate()} data-testid="button-org-apply">{apply.isPending ? "Sending…" : "Send the application"}</Button>
      </div>
    </div>
  );
}
