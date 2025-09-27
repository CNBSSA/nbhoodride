import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useGeolocation } from "@/hooks/useGeolocation";

interface SOSModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRideId?: string;
}

export default function SOSModal({ isOpen, onClose, currentRideId }: SOSModalProps) {
  const [selectedIncident, setSelectedIncident] = useState<string>("");
  const { toast } = useToast();
  const { location } = useGeolocation();

  const emergencyMutation = useMutation({
    mutationFn: async (incidentData: any) => {
      const response = await apiRequest('POST', '/api/emergency', incidentData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Emergency Alert Sent",
        description: "Emergency services and PG Ride support have been notified.",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Emergency Alert Failed",
        description: "Please call 911 directly if you're in immediate danger.",
        variant: "destructive",
      });
    }
  });

  const handleEmergencyAction = (type: string) => {
    if (type === "call-911") {
      window.location.href = "tel:911";
      return;
    }

    const incidentData = {
      incidentType: type,
      rideId: currentRideId,
      location: location ? { lat: location.latitude, lng: location.longitude } : null,
      description: `Emergency incident: ${type}`
    };

    emergencyMutation.mutate(incidentData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <Card className="w-full mx-4 bg-destructive text-destructive-foreground">
        <div className="flex items-center justify-between p-4 border-b border-white/20">
          <h2 className="text-lg font-semibold text-white">Emergency SOS</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/80 hover:text-white"
            data-testid="button-close-sos"
          >
            <i className="fas fa-times" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-6">
          <div className="text-center">
            <i className="fas fa-exclamation-triangle text-6xl mb-4" />
            <h3 className="text-xl font-semibold mb-2 text-white">Need Emergency Help?</h3>
            <p className="text-white/90">
              Choose from the options below or call 911 immediately if you're in immediate danger.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={() => handleEmergencyAction("call-911")}
              className="w-full bg-white text-destructive py-4 text-lg font-semibold hover:bg-white/90"
              data-testid="button-call-911"
            >
              <i className="fas fa-phone mr-2" />
              Call 911
            </Button>
            
            <Button
              onClick={() => handleEmergencyAction("safety-contact")}
              variant="secondary"
              className="w-full bg-white/20 text-white py-3 font-semibold hover:bg-white/30"
              data-testid="button-safety-contact"
            >
              <i className="fas fa-shield-alt mr-2" />
              Contact PG Ride Safety
            </Button>
            
            <Button
              onClick={() => handleEmergencyAction("emergency-contact")}
              variant="secondary"
              className="w-full bg-white/20 text-white py-3 font-semibold hover:bg-white/30"
              data-testid="button-emergency-contact"
            >
              <i className="fas fa-user-friends mr-2" />
              Call Emergency Contact
            </Button>
            
            <Button
              onClick={() => handleEmergencyAction("share-location")}
              variant="secondary"
              className="w-full bg-white/20 text-white py-3 font-semibold hover:bg-white/30"
              data-testid="button-share-location"
            >
              <i className="fas fa-map-marker-alt mr-2" />
              Share Live Location
            </Button>
          </div>

          <Card className="bg-white/10 border-white/20">
            <CardContent className="p-4">
              <p className="text-sm text-white/90">
                Your current location and ride details are being monitored for your safety. 
                Emergency services will be contacted if needed.
              </p>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
