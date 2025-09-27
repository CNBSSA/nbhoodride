import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import DocumentUploadModal from "@/components/DocumentUploadModal";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function Profile() {
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Become driver mutation
  const becomeDriverMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/driver/profile', {
        userId: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Driver Profile Created",
        description: "You can now upload your documents to start driving.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setIsDocumentModalOpen(true);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Failed to Create Driver Profile",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    }
  });

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? "text-yellow-500" : "text-muted-foreground"}>
        ★
      </span>
    ));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <i className="fas fa-spinner animate-spin text-2xl mb-2" />
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="bg-card border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <i className="fas fa-user text-primary text-2xl" />
          <div>
            <h1 className="text-lg font-bold">Profile</h1>
            <p className="text-xs text-muted-foreground">Account & Settings</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-destructive"
          data-testid="button-logout"
        >
          <i className="fas fa-sign-out-alt" />
        </Button>
      </header>

      <main className="p-4 space-y-6">
        {/* User Profile Header */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-bold">
                {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold" data-testid="text-user-name">
                  {user?.firstName} {user?.lastName}
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-user-email">
                  {user?.email}
                </p>
                {user?.phone && (
                  <p className="text-sm text-muted-foreground" data-testid="text-user-phone">
                    {user.phone}
                  </p>
                )}
                <div className="flex items-center space-x-1 mt-1">
                  <div className="flex text-sm">
                    {renderStars(Math.floor(parseFloat(user?.rating || "5")))}
                  </div>
                  <span className="text-sm text-muted-foreground" data-testid="text-user-rating">
                    {user?.rating} ({user?.totalRides || 0} rides)
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-primary" data-testid="button-edit-profile">
                Edit
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Driver Section */}
        {!user?.isDriver ? (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">Become a Driver</h3>
                  <p className="text-sm text-muted-foreground">
                    Start earning by giving rides to your neighbors
                  </p>
                </div>
                <Button
                  onClick={() => becomeDriverMutation.mutate()}
                  disabled={becomeDriverMutation.isPending}
                  className="bg-primary text-primary-foreground"
                  data-testid="button-become-driver"
                >
                  {becomeDriverMutation.isPending ? "Setting up..." : "Get Started"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-secondary/20 bg-secondary/5">
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <i className="fas fa-check-circle text-secondary text-xl" />
                <div>
                  <h3 className="font-semibold text-foreground">Driver Account Active</h3>
                  <p className="text-sm text-muted-foreground">
                    {user?.driverProfile?.isVerifiedNeighbor 
                      ? "Verified Neighbor • Ready to drive"
                      : "Documents under review"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <div className="space-y-3">
          {user?.isDriver && (
            <Button
              variant="outline"
              className="w-full justify-between p-4"
              onClick={() => setIsDocumentModalOpen(true)}
              data-testid="button-driver-documents"
            >
              <div className="flex items-center space-x-3">
                <i className="fas fa-id-card text-primary text-xl" />
                <div className="text-left">
                  <p className="font-medium">Driver Documents</p>
                  <p className="text-sm text-muted-foreground">License, Insurance, Vehicle Photos</p>
                </div>
              </div>
              <i className="fas fa-chevron-right text-muted-foreground" />
            </Button>
          )}

          <Button
            variant="outline"
            className="w-full justify-between p-4"
            data-testid="button-safety-privacy"
          >
            <div className="flex items-center space-x-3">
              <i className="fas fa-shield-alt text-secondary text-xl" />
              <div className="text-left">
                <p className="font-medium">Safety & Privacy</p>
                <p className="text-sm text-muted-foreground">Emergency contacts, privacy settings</p>
              </div>
            </div>
            <i className="fas fa-chevron-right text-muted-foreground" />
          </Button>

          <Button
            variant="outline"
            className="w-full justify-between p-4"
            data-testid="button-payment-methods"
          >
            <div className="flex items-center space-x-3">
              <i className="fas fa-credit-card text-accent text-xl" />
              <div className="text-left">
                <p className="font-medium">Payment Methods</p>
                <p className="text-sm text-muted-foreground">Currently: Cash Only</p>
              </div>
            </div>
            <i className="fas fa-chevron-right text-muted-foreground" />
          </Button>

          <Button
            variant="outline"
            className="w-full justify-between p-4"
            data-testid="button-help-support"
          >
            <div className="flex items-center space-x-3">
              <i className="fas fa-question-circle text-primary text-xl" />
              <div className="text-left">
                <p className="font-medium">Help & Support</p>
                <p className="text-sm text-muted-foreground">Contact us, FAQ, community guidelines</p>
              </div>
            </div>
            <i className="fas fa-chevron-right text-muted-foreground" />
          </Button>
        </div>

        {/* Community Badge */}
        {user?.isVerified && (
          <Card className="bg-gradient-to-r from-secondary to-primary text-white">
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <i className="fas fa-award text-2xl" />
                <div>
                  <h3 className="font-semibold">Verified PG County Neighbor</h3>
                  <p className="text-sm opacity-90">
                    Trusted member since {new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* App Information */}
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-foreground">PG Ride v1.0</h3>
              <p className="text-sm text-muted-foreground">
                Community rideshare for Prince George's County
              </p>
              <div className="flex justify-center space-x-4 text-xs text-muted-foreground">
                <span>Privacy Policy</span>
                <span>•</span>
                <span>Terms of Service</span>
                <span>•</span>
                <span>Support</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
      />
    </>
  );
}
