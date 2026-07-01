import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useLocation, Link } from 'wouter';
import { queryClient, getCsrfToken } from '@/lib/queryClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState<{ email: string } | null>(null);
  const [resending, setResending] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleResendVerification = async () => {
    if (!verificationRequired) return;
    setResending(true);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' },
        body: JSON.stringify({ email: verificationRequired.email }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Could not resend verification email');
      }
      toast({
        title: 'Verification email sent',
        description: `If an unverified account exists for ${verificationRequired.email}, a fresh link has been sent.`,
      });
    } catch (error: any) {
      toast({
        title: 'Resend failed',
        description: error.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setResending(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setVerificationRequired(null);

    try {
      const response = await fetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error?.emailVerificationRequired && error.email) {
          setVerificationRequired({ email: error.email });
          toast({
            title: 'Verify your email',
            description: error.message || 'Please click the link in your inbox to finish signing up.',
            variant: 'destructive',
          });
          return;
        }
        throw new Error(error?.message || 'Login failed');
      }

      const data = await response.json();

      // Invalidate auth cache to refresh authentication state
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });

      toast({
        title: "Login Successful!",
        description: `Welcome back, ${data.user.firstName}!`,
      });

      setTimeout(() => {
        setLocation('/');
      }, 500);
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-car text-2xl text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-login-title">
            Welcome Back
          </CardTitle>
          <CardDescription>
            Login to your PG Ride account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {verificationRequired && (
            <div className="mb-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950" data-testid="banner-verify-email">
              <p className="text-orange-900 dark:text-orange-200">
                Your email <span className="font-semibold">{verificationRequired.email}</span> isn't verified yet. Check your inbox for the link, or resend it below.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={resending}
                onClick={handleResendVerification}
                data-testid="button-resend-verification"
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </Button>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password">
                  <span className="text-xs text-primary hover:underline cursor-pointer" data-testid="link-forgot-password">
                    Forgot password?
                  </span>
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <p className="text-muted-foreground">
              Don't have an account?{' '}
              <Link href="/signup">
                <span className="text-primary hover:underline cursor-pointer" data-testid="link-signup">
                  Sign up here
                </span>
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
