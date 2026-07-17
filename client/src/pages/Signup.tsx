import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useLocation, Link } from 'wouter';
import { queryClient, getCsrfToken } from '@/lib/queryClient';
import { PG_CARD } from '@shared/userFacingCopy';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Mirror of server-side validatePasswordComplexity. Used both for the
  // live checklist UI and to gate the submit button so the user can't
  // submit a password the server will reject anyway.
  const passwordRulesMet =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [emailDeliveryWarning, setEmailDeliveryWarning] = useState<string | null>(null);
  const [signupEmail, setSignupEmail] = useState('');
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (!termsAccepted || !privacyAccepted) {
      toast({
        title: "Consent Required",
        description: "You must accept the Terms of Service and Privacy Policy to sign up.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          phone,
          termsAccepted,
          privacyAccepted,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Signup failed');
      }

      const data = await response.json();
      
      if (data.pendingApproval) {
        setSignupEmail(email);
        setEmailDeliveryWarning(data.emailDeliveryWarning ?? null);
        setPendingApproval(true);
        toast({
          title: data.emailVerificationSent ? "Account Created!" : "Account Created — check email setup",
          description: data.emailDeliveryWarning || data.message,
          variant: data.emailVerificationSent ? "default" : "destructive",
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      
      toast({
        title: "Signup Successful!",
        description: `Welcome to PG Ride, ${data.user.firstName}!`,
      });

      setTimeout(() => {
        setLocation('/');
      }, 500);
    } catch (error: any) {
      toast({
        title: "Signup Failed",
        description: error.message || "Unable to create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-clock text-2xl text-orange-500" />
            </div>
            <h2 className="text-xl font-bold mb-2" data-testid="text-pending-title">Almost there — two steps</h2>
            <ol className="text-left text-sm text-muted-foreground mb-4 space-y-2 list-decimal list-inside">
              <li>
                <strong className="text-foreground">Verify your email</strong> — we sent a link to{" "}
                <span className="font-medium text-foreground">{signupEmail || email}</span>. Check spam/junk too.
              </li>
              <li>
                <strong className="text-foreground">Account approval</strong> — after you verify, our team reviews new accounts (usually within 24 hours). We will email you when you can log in.
              </li>
            </ol>
            {emailDeliveryWarning && (
              <p className="text-sm text-destructive mb-4" data-testid="text-email-warning">
                {emailDeliveryWarning}
              </p>
            )}
            <p className="text-xs text-muted-foreground mb-4">
              Want to drive? After you can log in, open Profile to upload driver documents. That review is separate from your account approval.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full mb-2" data-testid="btn-back-to-login">Back to Login (resend verification)</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-car text-2xl text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-signup-title">
            Create Your Account
          </CardTitle>
          <CardDescription>
            Join Maryland's community ride-share platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  data-testid="input-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  data-testid="input-lastname"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number (Optional)</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(202) 555-1234"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-phone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 chars · 1 of each: A·a·1·!"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                data-testid="input-password"
              />
              {/* Live mirror of the server's password complexity rule
                  (server/routes.ts validatePasswordComplexity). Stays grey
                  until the user starts typing, then ticks green per match. */}
              {(() => {
                const rules = [
                  { ok: password.length >= 8, label: 'At least 8 characters' },
                  { ok: /[A-Z]/.test(password), label: 'One uppercase letter (A–Z)' },
                  { ok: /[a-z]/.test(password), label: 'One lowercase letter (a–z)' },
                  { ok: /[0-9]/.test(password), label: 'One number (0–9)' },
                  { ok: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password), label: 'One special character (!@#$%^&* etc.)' },
                ];
                return (
                  <ul className="text-xs space-y-1 mt-1" aria-label="Password requirements">
                    {rules.map((rule) => (
                      <li
                        key={rule.label}
                        data-testid={`pw-rule-${rule.ok ? 'ok' : 'pending'}`}
                        className={
                          password.length === 0
                            ? 'text-muted-foreground'
                            : rule.ok
                              ? 'text-green-700 dark:text-green-400'
                              : 'text-muted-foreground'
                        }
                      >
                        <span aria-hidden="true">{password.length === 0 ? '○' : rule.ok ? '✓' : '○'}</span>{' '}
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                data-testid="input-confirm-password"
              />
            </div>

            <div className="space-y-2 pt-2">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input cursor-pointer"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  required
                  data-testid="checkbox-terms"
                />
                <span className="text-muted-foreground">
                  I agree to the{" "}
                  <a href="/terms" className="underline text-primary" target="_blank" rel="noopener noreferrer">
                    Terms of Service
                  </a>
                  .
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input cursor-pointer"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  required
                  data-testid="checkbox-privacy"
                />
                <span className="text-muted-foreground">
                  I agree to the{" "}
                  <a href="/privacy" className="underline text-primary" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !termsAccepted || !privacyAccepted || !passwordRulesMet || password !== confirmPassword}
              data-testid="button-signup"
            >
              {isLoading ? 'Creating Account...' : 'Sign Up'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <p className="text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login">
                <span className="text-primary hover:underline cursor-pointer" data-testid="link-login">
                  Login here
                </span>
              </Link>
            </p>
          </div>

          <div className="mt-4 text-xs text-center">
            <p className="text-green-700 dark:text-green-400 font-medium">
              🎉 New riders get $20 in {PG_CARD.name} credit + 4 rides with $5 off each!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
