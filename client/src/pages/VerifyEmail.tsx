import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react";

/**
 * Landing page for the email-verification link. The signup email points at
 * /verify-email?token=… — without this page the link 404s and, because login
 * is hard-gated on verification, no new account could ever sign in.
 */
export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");
  // React 18 StrictMode double-invokes effects in dev; the token is single-use
  // so guard against firing the POST twice.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token. Please use the link from your email, or request a new one from the login page.");
      return;
    }

    apiRequest("POST", "/api/auth/verify-email", { token })
      .then(async (res) => {
        const data = await res.json();
        setState("success");
        setMessage(data.message || "Email verified successfully!");
      })
      .catch((err) => {
        setState("error");
        setMessage(String(err?.message ?? err).replace(/^\d+:\s*/, "") || "Verification failed. The link may have expired.");
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md mx-auto border-0 shadow-2xl">
        <CardContent className="p-8 text-center space-y-4">
          {state === "verifying" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
              <h1 className="text-xl font-bold" data-testid="verify-email-verifying">Verifying your email…</h1>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle className="w-12 h-12 mx-auto text-green-500" />
              <h1 className="text-xl font-bold" data-testid="verify-email-success">Email verified!</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <p className="text-sm text-muted-foreground">
                Next step: an administrator reviews and approves new accounts —
                you'll be able to log in as soon as that's done.
              </p>
              <Button className="w-full" onClick={() => setLocation("/login")} data-testid="button-goto-login">
                Go to Login
              </Button>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-destructive" />
              <h1 className="text-xl font-bold" data-testid="verify-email-error">Verification failed</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Mail className="w-4 h-4" />
                You can request a fresh link from the login page.
              </p>
              <Button className="w-full" onClick={() => setLocation("/login")} data-testid="button-goto-login-error">
                Go to Login
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
