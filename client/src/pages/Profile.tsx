import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import DocumentUploadModal from "@/components/DocumentUploadModal";
import SafetyPrivacyModal from "@/components/SafetyPrivacyModal";
import TopUpModal from "@/components/TopUpModal";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Bell, BellOff, Plus, MapPin, ChevronDown, ChevronUp, CheckSquare, Square } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { MD_COUNTIES } from "../../../shared/schema";

export default function Profile() {
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isSafetyPrivacyModalOpen, setIsSafetyPrivacyModalOpen] = useState(false);
  const { permission, isSubscribed, isSupported, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [showCountySelector, setShowCountySelector] = useState(false);
  const [localCounties, setLocalCounties] = useState<string[]>([]);
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch driver county preferences
  const { data: countyData } = useQuery({
    queryKey: ["/api/driver/counties"],
    enabled: !!user?.isDriver,
    select: (data: any) => (data?.acceptedCounties ?? []) as string[],
  });
  const savedCounties: string[] = countyData ?? [];

  // County save mutation
  const saveCountiesMutation = useMutation({
    mutationFn: async (counties: string[]) => {
      await apiRequest("PUT", "/api/driver/counties", { acceptedCounties: counties });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/counties"] });
      toast({ title: "Counties updated", description: "Your service area has been saved." });
      setShowCountySelector(false);
    },
    onError: () => {
      toast({ title: "Failed to save", description: "Could not update county preferences.", variant: "destructive" });
    },
  });

  function openCountySelector() {
    setLocalCounties(savedCounties.length > 0 ? [...savedCounties] : [...MD_COUNTIES]);
    setShowCountySelector(true);
  }

  function toggleCounty(county: string) {
    setLocalCounties(prev =>
      prev.includes(county) ? prev.filter(c => c !== county) : [...prev, county]
    );
  }

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

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      // Invalidate auth cache to clear user state
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      
      // Redirect to landing page
      window.location.href = "/";
    } catch (error) {
      console.error('Logout error:', error);
      // Even if logout fails, clear the cache and redirect
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      window.location.href = "/";
    }
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

        {/* Virtual PG Card Balance */}
        <Card className="border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-green-600 dark:bg-green-700 rounded-full flex items-center justify-center">
                  <i className="fas fa-credit-card text-white text-xl" />
                </div>
                <div>
                  <p className="text-xs text-green-800 dark:text-green-300 font-medium">PG Virtual Card</p>
                  <h3 className="text-2xl font-bold text-green-900 dark:text-green-100" data-testid="text-virtual-balance">
                    ${parseFloat(user?.virtualCardBalance || "0").toFixed(2)}
                  </h3>
                  <p className="text-xs text-green-700 dark:text-green-400">Available Balance</p>
                  {(user?.promoRidesRemaining ?? 0) > 0 && (
                    <p className="text-xs text-orange-600 dark:text-orange-400 font-semibold mt-0.5">
                      🎉 {user?.promoRidesRemaining} welcome ride{(user?.promoRidesRemaining ?? 0) > 1 ? "s" : ""} left (-$5 each)
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right space-y-2">
                <Button
                  size="sm"
                  onClick={() => setIsTopUpOpen(true)}
                  className="bg-green-600 hover:bg-green-700 text-white text-xs px-3"
                  data-testid="button-add-funds"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Funds
                </Button>
                <div className="inline-flex items-center space-x-1 bg-green-100 dark:bg-green-900 px-2 py-1 rounded">
                  <i className="fas fa-check-circle text-green-600 dark:text-green-400 text-xs" />
                  <span className="text-xs font-medium text-green-900 dark:text-green-100">Active</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <TopUpModal
          isOpen={isTopUpOpen}
          onClose={() => setIsTopUpOpen(false)}
          currentBalance={user?.virtualCardBalance || "0"}
        />

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

          {user?.isDriver && (
            <div className="border rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                onClick={() => showCountySelector ? setShowCountySelector(false) : openCountySelector()}
              >
                <div className="flex items-center space-x-3">
                  <MapPin className="text-primary w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-medium">Service Counties</p>
                    <p className="text-sm text-muted-foreground">
                      {savedCounties.length === 0
                        ? "All Maryland counties"
                        : savedCounties.length === 1
                        ? savedCounties[0]
                        : `${savedCounties.length} counties selected`}
                    </p>
                  </div>
                </div>
                {showCountySelector ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>

              {showCountySelector && (
                <div className="border-t p-4 space-y-3 bg-background">
                  <p className="text-xs text-muted-foreground">
                    Select the counties you want to accept rides in. Leave all selected to cover all of Maryland.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setLocalCounties([...MD_COUNTIES])}>
                      <CheckSquare className="w-3 h-3 mr-1" /> All
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setLocalCounties([])}>
                      <Square className="w-3 h-3 mr-1" /> None
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 max-h-64 overflow-y-auto">
                    {MD_COUNTIES.map(county => (
                      <label key={county} className="flex items-center space-x-2 py-1 cursor-pointer hover:bg-muted/30 rounded px-1">
                        <input
                          type="checkbox"
                          checked={localCounties.includes(county)}
                          onChange={() => toggleCounty(county)}
                          className="rounded"
                        />
                        <span className="text-sm">{county}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => saveCountiesMutation.mutate(localCounties)}
                      disabled={saveCountiesMutation.isPending}
                    >
                      {saveCountiesMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowCountySelector(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full justify-between p-4"
            onClick={() => setIsSafetyPrivacyModalOpen(true)}
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

          {/* Push Notification Toggle */}
          {isSupported && permission !== "denied" && (
            <div className="w-full flex items-center justify-between p-4 border rounded-xl" data-testid="push-notification-setting">
              <div className="flex items-center space-x-3">
                {isSubscribed
                  ? <Bell className="text-primary w-5 h-5" />
                  : <BellOff className="text-muted-foreground w-5 h-5" />
                }
                <div className="text-left">
                  <p className="font-medium">Ride Notifications</p>
                  <p className="text-sm text-muted-foreground">
                    {isSubscribed
                      ? "You'll be notified even when the app is closed"
                      : permission === "granted"
                        ? "Tap to re-enable notifications"
                        : "Get alerts when your driver accepts or arrives"
                    }
                  </p>
                </div>
              </div>
              <Switch
                checked={isSubscribed}
                onCheckedChange={(checked) => checked ? subscribe() : unsubscribe()}
                disabled={pushLoading}
                data-testid="toggle-push-notifications"
              />
            </div>
          )}
          {isSupported && permission === "denied" && (
            <div className="w-full flex items-center space-x-3 p-4 border rounded-xl text-muted-foreground" data-testid="push-blocked-notice">
              <BellOff className="w-5 h-5 shrink-0" />
              <p className="text-sm">Notifications blocked in browser settings. Enable them in your browser to receive ride alerts.</p>
            </div>
          )}
        </div>

        {/* Community Badge */}
        {user?.isVerified && (
          <Card className="bg-gradient-to-r from-secondary to-primary text-white">
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <i className="fas fa-award text-2xl" />
                <div>
                  <h3 className="font-semibold">Verified Maryland Neighbor</h3>
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
                Community rideshare for Maryland
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

      {/* Safety & Privacy Modal */}
      <SafetyPrivacyModal
        isOpen={isSafetyPrivacyModalOpen}
        onClose={() => setIsSafetyPrivacyModalOpen(false)}
      />
    </>
  );
}
