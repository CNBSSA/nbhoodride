/**
 * The business sign-in: the same account and password as everywhere else,
 * the same endpoint and limits, but it lands in the organization portal and
 * is remembered on this device. The rider sign-in at /login is untouched.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, getCsrfToken } from "@/lib/queryClient";
import { rememberBusinessHome } from "@/lib/businessHome";
import { safePortalNext } from "@shared/invitations";
import { BRAND } from "@shared/branding";

export function businessNext(): string {
  if (typeof window === "undefined") return "/org";
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next) return safePortalNext(next);
  // Signed-out visit to the portal itself: come back to the same organization.
  if (window.location.pathname.startsWith("/org") && !window.location.pathname.startsWith("/org/login")) {
    return safePortalNext(window.location.pathname + window.location.search);
  }
  return "/org";
}

export default function BusinessLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sessionExpired = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "1";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/email-login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() ?? "" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.message || "Sign-in failed");
      }
      const data = await response.json();
      rememberBusinessHome();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Signed in", description: `Welcome back, ${data.user.firstName}. Opening your desk.` });
      setLocation(businessNext());
    } catch (error: any) {
      toast({ title: "Sign-in failed", description: error.message || "Invalid credentials", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4" data-testid="business-login">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <Building2 className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-business-login-title">{BRAND.appName} for Business</CardTitle>
          <CardDescription>Sign in to your organization's booking desk</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionExpired && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950" data-testid="banner-session-expired">
              <p className="text-blue-900 dark:text-blue-200">Your session expired. Please sign in again to continue.</p>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business-email">Work email</Label>
              <Input id="business-email" type="email" placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" data-testid="input-business-email" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="business-password">Password</Label>
                <Link href="/forgot-password">
                  <span className="text-xs text-primary hover:underline cursor-pointer" data-testid="link-business-forgot-password">Forgot password?</span>
                </Link>
              </div>
              <Input id="business-password" type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-testid="input-business-password" />
            </div>
            <Button type="submit" className="w-full min-h-[44px]" disabled={isLoading} data-testid="button-business-login">
              {isLoading ? "Signing in…" : "Sign in to the desk"}
            </Button>
          </form>
          <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
            <p>Invited by your organization? Open the link in that email to set up your sign-in.</p>
            <p>
              Need an organization account? Email{" "}
              <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline" data-testid="link-business-support">{BRAND.supportEmail}</a>.
            </p>
            <p>
              Riding for yourself?{" "}
              <Link href="/login"><span className="text-primary hover:underline cursor-pointer" data-testid="link-rider-login">Rider sign-in</span></Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
