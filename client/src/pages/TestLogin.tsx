import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';

export default function TestLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const testRiders = [
    { name: 'Magdeline Akingba', email: 'magdelineakingba@gmail.com', phone: '(202) 381-6766' },
    { name: 'Wunmi Akingba', email: 'wunmiakingba@gmail.com', phone: '(202) 731-1949' },
    { name: 'Bola Akingba', email: 'bolaakingba@gmail.com', phone: '(240) 532-9500' },
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }

      const data = await response.json();
      
      toast({
        title: "Login Successful!",
        description: `Welcome back, ${data.user.firstName}!`,
      });

      // Redirect to home page
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

  const quickLogin = (riderEmail: string) => {
    setEmail(riderEmail);
    setPassword('Fes5036tus@3');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center" data-testid="text-login-title">
            Test Login
          </CardTitle>
          <CardDescription className="text-center">
            Login as one of the test riders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertDescription>
              This is a test login page for development. Use the quick login buttons below or enter credentials manually.
            </AlertDescription>
          </Alert>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
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

          <div className="space-y-2">
            <div className="text-sm font-medium text-center mb-3">Quick Login</div>
            <div className="space-y-2">
              {testRiders.map((rider, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="w-full justify-start text-left"
                  onClick={() => quickLogin(rider.email)}
                  data-testid={`button-quick-login-${index}`}
                >
                  <div className="flex flex-col items-start">
                    <div className="font-medium">{rider.name}</div>
                    <div className="text-xs text-muted-foreground">{rider.email}</div>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          <div className="text-center text-sm text-muted-foreground">
            <p>Password: Fes5036tus@3</p>
            <p className="mt-2">All test accounts have $1000 virtual card balance</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
