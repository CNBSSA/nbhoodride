import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        <Card className="border-0 shadow-2xl">
          <CardContent className="p-8 text-center space-y-6">
            {/* Logo */}
            <div className="space-y-2">
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto">
                <i className="fas fa-car text-2xl text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">PG Ride</h1>
              <p className="text-muted-foreground text-sm">Community Rideshare</p>
            </div>

            {/* Welcome Message */}
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-foreground">
                Welcome to PG County's Community Ride-Share
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Connect with trusted neighbors for safe, transparent, and affordable rides 
                throughout Prince George's County. Your ride from neighbors, by neighbors.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3 text-left">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-secondary/20 rounded-full flex items-center justify-center">
                  <i className="fas fa-shield-alt text-secondary text-sm" />
                </div>
                <span className="text-sm">Verified neighborhood drivers</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                  <i className="fas fa-calculator text-primary text-sm" />
                </div>
                <span className="text-sm">Transparent pricing, no surge fees</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                  <i className="fas fa-hand-holding-usd text-accent text-sm" />
                </div>
                <span className="text-sm">Cash-friendly payments</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-destructive/20 rounded-full flex items-center justify-center">
                  <i className="fas fa-exclamation-triangle text-destructive text-sm" />
                </div>
                <span className="text-sm">Built-in safety features & SOS</span>
              </div>
            </div>

            {/* Login Button */}
            <Button 
              onClick={handleLogin}
              className="w-full text-lg py-6"
              data-testid="button-login"
            >
              Get Started
            </Button>

            <p className="text-xs text-muted-foreground">
              By continuing, you agree to our community guidelines and terms of service.
            </p>

            {/* Test Login Link */}
            <div className="pt-4 border-t">
              <Link href="/test-login">
                <Button variant="ghost" size="sm" className="w-full text-xs" data-testid="link-test-login">
                  Test Login (Development)
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
