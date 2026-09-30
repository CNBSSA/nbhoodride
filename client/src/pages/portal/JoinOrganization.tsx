/**
 * "Join <organization>": the page an invitation link opens. Name, phone,
 * password, the terms — then straight into the desk. Someone who already
 * holds an account with that email is attached and sent to sign in.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, getCsrfToken } from "@/lib/queryClient";
import { rememberBusinessHome } from "@/lib/businessHome";
import { BRAND } from "@shared/branding";

interface Invitation {
  organizationId: string; organizationName: string; email: string; role: string;
  state: "open" | "accepted" | "expired"; refusal: string | null; days: number; hasAccount: boolean;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

export default function JoinOrganization({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: inv, isLoading, error } = useQuery<Invitation>({ queryKey: ["/api/org/invitations", token], queryFn: () => call<Invitation>("GET", `/api/org/invitations/${encodeURIComponent(token)}`), retry: false });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [joinedExisting, setJoinedExisting] = useState<{ organizationId: string; organizationName: string } | null>(null);

  const accept = useMutation({
    mutationFn: () => call<{ organizationId: string; organizationName: string; existing: boolean }>("POST", `/api/org/invitations/${encodeURIComponent(token)}/accept`, {
      firstName, lastName, phone, password, termsAccepted: agreed, privacyAccepted: agreed,
    }),
    onSuccess: async (r) => {
      if (r.existing) { setJoinedExisting(r); return; }
      rememberBusinessHome();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: `Welcome to ${r.organizationName}`, description: "Your desk is open." });
      setLocation(`/org?org=${encodeURIComponent(r.organizationId)}`);
    },
    onError: (e: Error) => toast({ title: "Could not join", description: e.message, variant: "destructive" }),
  });

  const shell = (body: React.ReactNode, title: string, description?: string) => (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4" data-testid="join-organization">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4"><Building2 className="h-8 w-8 text-primary-foreground" /></div>
          <CardTitle className="text-2xl" data-testid="text-join-title">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );

  if (isLoading) return shell(<p className="text-sm text-muted-foreground text-center" data-testid="join-loading">Checking your invitation…</p>, "One moment");
  if (error || !inv) return shell(
    <div className="space-y-4 text-center text-sm">
      <p className="text-muted-foreground" data-testid="join-invalid">{(error as Error)?.message ?? "This invitation link is not valid."}</p>
      <Link href="/org/login"><Button variant="outline" className="min-h-[44px]" data-testid="button-join-go-sign-in">Go to business sign-in</Button></Link>
    </div>, "Invitation not found");
  if (inv.refusal) return shell(
    <div className="space-y-4 text-center text-sm">
      <p className="text-muted-foreground" data-testid="join-refused">{inv.refusal}</p>
      <Link href={`/org/login?next=${encodeURIComponent(`/org?org=${inv.organizationId}`)}`}><Button variant="outline" className="min-h-[44px]" data-testid="button-join-go-sign-in">Go to business sign-in</Button></Link>
    </div>, `${inv.organizationName}`);
  if (joinedExisting || inv.hasAccount) {
    const org = joinedExisting ?? inv;
    return shell(
      <div className="space-y-4 text-center text-sm">
        <p className="text-muted-foreground" data-testid="join-existing">
          {joinedExisting ? `You are now a member of ${org.organizationName}.` : `${inv.email} already has a ${BRAND.appName} account.`} Sign in with your usual password to open the desk.
        </p>
        {!joinedExisting && <Button className="w-full min-h-[44px]" disabled={accept.isPending} onClick={() => accept.mutate()} data-testid="button-join-attach-existing">Add me to {inv.organizationName}</Button>}
        <Link href={`/org/login?next=${encodeURIComponent(`/org?org=${org.organizationId}`)}`}><Button variant="outline" className="w-full min-h-[44px]" data-testid="button-join-go-sign-in">Go to business sign-in</Button></Link>
      </div>, `Join ${org.organizationName}`);
  }

  return shell(
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (agreed) accept.mutate(); }}>
      <p className="text-sm text-muted-foreground">You were invited as <strong>{inv.role}</strong> for <strong>{inv.organizationName}</strong>, at <strong>{inv.email}</strong>. Set up your sign-in and you land straight in the desk.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label htmlFor="join-first">First name</Label><Input id="join-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={50} data-testid="input-join-first-name" /></div>
        <div className="space-y-2"><Label htmlFor="join-last">Last name</Label><Input id="join-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={50} data-testid="input-join-last-name" /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="join-phone">Phone</Label><Input id="join-phone" type="tel" placeholder="(301) 555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="input-join-phone" /></div>
      <div className="space-y-2"><Label htmlFor="join-password">Choose a password</Label><Input id="join-password" type="password" placeholder="At least 8 chars · 1 of each: A·a·1·!" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" data-testid="input-join-password" /></div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} data-testid="checkbox-join-terms" />
        <span>I accept the <Link href="/terms"><span className="text-primary hover:underline">Terms of Service</span></Link> and <Link href="/privacy"><span className="text-primary hover:underline">Privacy Policy</span></Link>.</span>
      </label>
      <Button type="submit" className="w-full min-h-[44px]" disabled={!agreed || accept.isPending} data-testid="button-join-organization">
        {accept.isPending ? "Joining…" : `Join ${inv.organizationName}`}
      </Button>
    </form>, `Join ${inv.organizationName}`, `${inv.organizationName} invited you to book on ${BRAND.appName}`);
}
