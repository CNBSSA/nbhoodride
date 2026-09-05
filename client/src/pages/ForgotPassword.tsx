import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Link, useLocation } from 'wouter';
import { getCsrfToken } from '@/lib/queryClient';

type Method = 'sms' | 'email';

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

/**
 * Two ways back in. "Text me a code" is the default when the server has
 * Twilio Verify configured — it does not depend on email delivery, which
 * is the usual reason a rider ends up here in the first place.
 */
export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [smsAvailable, setSmsAvailable] = useState<boolean | null>(null);
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/reset-options', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { setSmsAvailable(!!d.sms); if (d.sms) setMethod('sms'); })
      .catch(() => setSmsAvailable(false));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setIsLoading(true);
    try { await fn(); }
    catch (error: any) { toast({ title: "Couldn't do that", description: error.message, variant: 'destructive' }); }
    finally { setIsLoading(false); }
  };

  const sendCode = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const d = await post('/api/auth/forgot-password-sms', { email });
    setCodeSent(true);
    toast({ title: 'Check your phone', description: d.message });
  }); };

  const resetWithCode = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    await post('/api/auth/reset-password-sms', { email, code: code.trim(), newPassword });
    toast({ title: 'Password updated', description: 'Log in with your new password.' });
    setLocation('/login');
  }); };

  const sendEmail = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const d = await post('/api/auth/forgot-password', { email });
    setEmailSent(true);
    toast({ title: 'Password Reset Requested', description: d.message });
  }); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-key text-2xl text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-forgot-password-title">Reset Password</CardTitle>
          <CardDescription>
            {method === 'sms' ? "We'll text a code to the phone number on your account." : 'Enter your email to receive password reset instructions'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {smsAvailable && (
            <div className="grid grid-cols-2 gap-2" data-testid="reset-method-picker">
              <Button type="button" variant={method === 'sms' ? 'default' : 'outline'} onClick={() => setMethod('sms')} data-testid="btn-method-sms">Text me a code</Button>
              <Button type="button" variant={method === 'email' ? 'default' : 'outline'} onClick={() => setMethod('email')} data-testid="btn-method-email">Email me a link</Button>
            </div>
          )}

          {method === 'sms' && !codeSent && (
            <form onSubmit={sendCode} className="space-y-4" data-testid="form-sms-request">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" placeholder="The email you signed up with" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-submit">{isLoading ? 'Sending…' : 'Text me a code'}</Button>
            </form>
          )}

          {method === 'sms' && codeSent && (
            <form onSubmit={resetWithCode} className="space-y-4" data-testid="form-sms-reset">
              <Alert className="border-primary bg-primary/10">
                <AlertDescription>If that account has a phone on file, a code is on its way. It expires in about 10 minutes.</AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="code">Code from the text</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required data-testid="input-code" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required data-testid="input-new-password" />
                <p className="text-xs text-muted-foreground">At least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required data-testid="input-confirm-password" />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-reset">{isLoading ? 'Updating…' : 'Set new password'}</Button>
              <button type="button" className="w-full text-sm text-primary hover:underline" onClick={() => setCodeSent(false)} data-testid="btn-resend-code">Didn't get it? Send another code</button>
            </form>
          )}

          {method === 'email' && (
            <>
              {emailSent && (
                <Alert className="border-primary bg-primary/10">
                  <AlertDescription>If an account exists with this email, password reset instructions have been sent. Please check your email for the reset link.</AlertDescription>
                </Alert>
              )}
              <form onSubmit={sendEmail} className="space-y-4" data-testid="form-email-request">
                <div className="space-y-2">
                  <Label htmlFor="email-e">Email Address</Label>
                  <Input id="email-e" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-submit">{isLoading ? 'Sending...' : 'Send Reset Instructions'}</Button>
              </form>
            </>
          )}

          <div className="text-center text-sm space-y-2">
            <p className="text-muted-foreground">Remember your password?{' '}<Link href="/login"><span className="text-primary hover:underline cursor-pointer" data-testid="link-login">Login here</span></Link></p>
            <p className="text-muted-foreground">Don't have an account?{' '}<Link href="/signup"><span className="text-primary hover:underline cursor-pointer" data-testid="link-signup">Sign up here</span></Link></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
