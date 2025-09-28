import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface SafetyPrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SafetyPrivacyModal({ isOpen, onClose }: SafetyPrivacyModalProps) {
  const [emergencyContact, setEmergencyContact] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load current emergency contact
  const userQuery = useQuery({
    queryKey: ["/api/auth/user"],
    enabled: isOpen && !!user?.id,
  });

  useEffect(() => {
    if (userQuery.data?.emergencyContact) {
      setEmergencyContact(userQuery.data.emergencyContact);
    }
  }, [userQuery.data]);

  const updateEmergencyContactMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const response = await apiRequest('PUT', '/api/user/emergency-contact', {
        emergencyContact: phoneNumber
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Emergency Contact Updated",
        description: "Your emergency contact has been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: () => {
      toast({
        title: "Failed to Update",
        description: "Could not save emergency contact. Please try again.",
        variant: "destructive",
      });
    }
  });

  const testEmergencyContactMutation = useMutation({
    mutationFn: async (type: 'sms' | 'call') => {
      const response = await apiRequest('POST', '/api/emergency/test', {
        type,
        phoneNumber: emergencyContact
      });
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: `Test ${variables === 'sms' ? 'SMS' : 'Call'} Sent`,
        description: `A test ${variables === 'sms' ? 'message' : 'call'} was sent to ${emergencyContact}`,
      });
    },
    onError: (error, variables) => {
      toast({
        title: `Test ${variables === 'sms' ? 'SMS' : 'Call'} Failed`,
        description: "Please check the phone number and try again.",
        variant: "destructive",
      });
    }
  });

  const handleSave = () => {
    if (!emergencyContact.trim()) {
      toast({
        title: "Phone Number Required",
        description: "Please enter a valid phone number.",
        variant: "destructive",
      });
      return;
    }

    // Basic phone number validation (E.164 format)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(emergencyContact.replace(/[\s()-]/g, ''))) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number with country code (e.g., +1234567890).",
        variant: "destructive",
      });
      return;
    }

    updateEmergencyContactMutation.mutate(emergencyContact);
  };

  const handleTestSMS = () => {
    if (!emergencyContact.trim()) {
      toast({
        title: "Save Emergency Contact First",
        description: "Please save your emergency contact before testing.",
        variant: "destructive",
      });
      return;
    }
    testEmergencyContactMutation.mutate('sms');
  };

  const handleTestCall = () => {
    if (!emergencyContact.trim()) {
      toast({
        title: "Save Emergency Contact First", 
        description: "Please save your emergency contact before testing.",
        variant: "destructive",
      });
      return;
    }
    testEmergencyContactMutation.mutate('call');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <Card className="w-full mx-4 max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Safety & Privacy</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-close-safety-privacy"
          >
            <i className="fas fa-times" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Emergency Contact Section */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <i className="fas fa-phone text-red-500" />
              <h3 className="font-semibold">Emergency Contact</h3>
            </div>
            
            <p className="text-sm text-muted-foreground">
              This person will be contacted if you use the SOS feature during a ride. 
              Make sure it's someone who can respond quickly in emergencies.
            </p>

            <div className="space-y-2">
              <Label htmlFor="emergency-contact">Phone Number</Label>
              <Input
                id="emergency-contact"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                data-testid="input-emergency-contact"
              />
              <p className="text-xs text-muted-foreground">
                Include country code (e.g., +1 for US/Canada)
              </p>
            </div>

            <div className="flex space-x-2">
              <Button
                onClick={handleSave}
                disabled={updateEmergencyContactMutation.isPending}
                className="flex-1"
                data-testid="button-save-emergency-contact"
              >
                {updateEmergencyContactMutation.isPending ? "Saving..." : "Save Contact"}
              </Button>
            </div>

            {userQuery.data?.emergencyContact && (
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  onClick={handleTestSMS}
                  disabled={testEmergencyContactMutation.isPending}
                  className="flex-1"
                  data-testid="button-test-sms"
                >
                  {testEmergencyContactMutation.isPending ? "Sending..." : "Test SMS"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTestCall}
                  disabled={testEmergencyContactMutation.isPending}
                  className="flex-1"
                  data-testid="button-test-call"
                >
                  {testEmergencyContactMutation.isPending ? "Calling..." : "Test Call"}
                </Button>
              </div>
            )}
          </div>

          {/* Privacy Settings */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center space-x-2">
              <i className="fas fa-shield-alt text-blue-500" />
              <h3 className="font-semibold">Privacy Settings</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Share Location in Emergencies</p>
                  <p className="text-sm text-muted-foreground">
                    Allow sharing your live location during SOS alerts
                  </p>
                </div>
                <div className="text-green-600">
                  <i className="fas fa-check-circle" />
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Contact Emergency Services</p>
                  <p className="text-sm text-muted-foreground">
                    Emergency contacts can call 911 on your behalf if needed
                  </p>
                </div>
                <div className="text-green-600">
                  <i className="fas fa-check-circle" />
                </div>
              </div>
            </div>
          </div>

          {/* How SOS Works */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center space-x-2">
              <i className="fas fa-info-circle text-orange-500" />
              <h3 className="font-semibold">How SOS Works</h3>
            </div>
            
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong>When you press SOS:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Your emergency contact gets an SMS with your location</li>
                <li>A live tracking link is shared so they can follow you</li>
                <li>You can call 911 directly from the app</li>
                <li>PG Ride support is automatically notified</li>
              </ul>
              
              <p className="mt-3">
                <strong>Your privacy:</strong> Location sharing only happens during active emergencies and stops when resolved.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}