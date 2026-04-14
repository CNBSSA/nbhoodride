import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { X, Search, Users, CheckCircle, Loader2, MapPin, DollarSign } from "lucide-react";

interface JoinScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number; address: string };
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`,
      { headers: { "User-Agent": "PGRide-Community-Rideshare/1.0" } }
    );
    const results = await res.json();
    if (results.length > 0) return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
    return null;
  } catch {
    return null;
  }
}

function estimateFare(pickupLat: number, pickupLng: number, destLat: number, destLng: number): number {
  const R = 3958.8;
  const dLat = ((destLat - pickupLat) * Math.PI) / 180;
  const dLng = ((destLng - pickupLng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((pickupLat * Math.PI) / 180) * Math.cos((destLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3;
  const duration = Math.round((dist / 25) * 60);
  return Math.max(5, 2.5 + dist * 1.5 + duration * 0.3);
}

export default function JoinScheduleModal({ isOpen, onClose, userLocation }: JoinScheduleModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [code, setCode] = useState("");
  const [groupPreview, setGroupPreview] = useState<any>(null);
  const [pickupAddress, setPickupAddress] = useState(userLocation.address);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [joined, setJoined] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: async (scheduleCode: string) => {
      const res = await apiRequest("GET", `/api/rides/schedule/${scheduleCode.trim().toUpperCase()}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (!data || data.message) {
        toast({ title: "Code Not Found", description: "That schedule code doesn't exist or is closed.", variant: "destructive" });
        return;
      }
      setGroupPreview(data);
      setStep(2);
    },
    onError: () => {
      toast({ title: "Code Not Found", description: "That schedule code doesn't exist or is no longer open.", variant: "destructive" });
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/rides/join-schedule", data);
      return res.json();
    },
    onSuccess: () => {
      setJoined(true);
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to Join", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const handlePreview = () => {
    if (!code.trim()) return;
    previewMutation.mutate(code);
  };

  const handleGeocode = async () => {
    if (!destinationAddress.trim()) return;
    setGeocoding(true);
    const destCoords = await geocode(destinationAddress);
    setGeocoding(false);
    if (!destCoords) {
      toast({ title: "Address Not Found", description: "Please enter a valid destination.", variant: "destructive" });
      return;
    }
    const fare = estimateFare(userLocation.lat, userLocation.lng, destCoords.lat, destCoords.lng);
    setFareEstimate(fare);
    setStep(3);
  };

  const handleJoin = async () => {
    const destCoords = await geocode(destinationAddress);
    if (!destCoords) return;
    joinMutation.mutate({
      scheduleCode: code.trim().toUpperCase(),
      pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: pickupAddress },
      destinationLocation: { lat: destCoords.lat, lng: destCoords.lng, address: destinationAddress },
      paymentMethod: "card",
    });
  };

  const reset = () => {
    setStep(1);
    setCode("");
    setGroupPreview(null);
    setPickupAddress(userLocation.address);
    setDestinationAddress("");
    setFareEstimate(null);
    setJoined(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold">Join a Shared Schedule</h2>
            <p className="text-xs text-gray-500">Enter the code your friend shared with you</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-join-schedule">
            <X className="w-4 h-4 text-gray-400" />
          </Button>
        </div>

        {!joined && (
          <div className="flex gap-1 px-4 pb-3 flex-shrink-0">
            {["Code", "Your Route", "Confirm"].map((label, i) => (
              <div key={label} className={`flex-1 h-1 rounded-full ${step > i ? "bg-green-600" : step === i + 1 ? "bg-green-400" : "bg-gray-200"}`} />
            ))}
          </div>
        )}

        <CardContent className="overflow-y-auto p-4 space-y-4 flex-1">
          {/* Joined success */}
          {joined && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
              <p className="text-xl font-bold">You're In!</p>
              <p className="text-sm text-gray-600">Your ride has been booked at the discounted rate.</p>
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-3 text-xs text-green-700 space-y-1">
                  <p>✓ 30% discount applied to your fare</p>
                  <p>✓ You'll be picked up in order with the group</p>
                  <p>✓ Payment deducted when driver accepts</p>
                </CardContent>
              </Card>
              {fareEstimate && (
                <p className="text-lg font-bold text-green-700">You pay ${(fareEstimate * 0.7).toFixed(2)} <span className="text-sm font-normal text-gray-400 line-through">${fareEstimate.toFixed(2)}</span></p>
              )}
            </div>
          )}

          {/* Step 1 — Enter code */}
          {!joined && step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Schedule Code</label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="PG-XXXXXX"
                  className="text-center text-2xl font-mono font-bold tracking-widest h-14"
                  maxLength={12}
                  data-testid="input-schedule-code"
                />
              </div>
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-3 flex items-start gap-2">
                  <Users className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-purple-700">Your friend booked a ride and shared a code. Enter it here and you'll each pay your own discounted fare — 30% off when you join!</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 2 — Preview group + enter your route */}
          {!joined && step === 2 && groupPreview && (
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span className="font-semibold text-sm text-blue-800">Group Preview</span>
                  </div>
                  <div className="text-xs text-blue-700 space-y-1">
                    <p>Riders in group: <strong>{groupPreview.filledSlots}</strong> / {groupPreview.maxSlots}</p>
                    <p>Open slots: <strong>{groupPreview.maxSlots - groupPreview.filledSlots}</strong></p>
                    {groupPreview.scheduledAt && (
                      <p>Scheduled: <strong>{new Date(groupPreview.scheduledAt).toLocaleString()}</strong></p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <p className="text-sm font-semibold">Your Pickup & Destination</p>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Your Pickup</label>
                  <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Your pickup location" data-testid="input-join-pickup" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Your Destination</label>
                  <Input value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} placeholder="Where are you going?" data-testid="input-join-destination" />
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Confirm with discounted fare */}
          {!joined && step === 3 && fareEstimate && (
            <div className="space-y-4">
              <p className="text-sm font-semibold">Confirm Your Ride</p>

              <Card className="bg-gradient-to-r from-green-50 to-purple-50 border-green-200">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-gray-500 mb-1">Your discounted fare</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-gray-400 line-through text-sm">${fareEstimate.toFixed(2)}</span>
                    <span className="text-3xl font-black text-green-700">${(fareEstimate * 0.7).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-green-600 font-medium mt-1">30% off — you save ${(fareEstimate * 0.3).toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400 mt-1 flex items-center justify-center gap-1">
                    <DollarSign className="w-3 h-3" /> Paid via Virtual PG Card at driver acceptance
                  </p>
                </CardContent>
              </Card>

              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Pickup:</span><span className="truncate">{pickupAddress}</span></div>
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Destination:</span><span className="truncate">{destinationAddress}</span></div>
              </div>

              <Card className="bg-amber-50 border-amber-200">
                <CardContent className="p-3 text-xs text-amber-700">
                  <p className="font-semibold mb-1">Important</p>
                  <p>The driver picks up everyone in the group before any drop-offs. Your ride may take a bit longer — but you save 30% and support community drivers!</p>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>

        <div className="p-4 border-t flex-shrink-0 space-y-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
          {joined && (
            <Button onClick={() => { reset(); onClose(); }} className="w-full h-12" data-testid="button-join-done">Done</Button>
          )}
          {!joined && step === 1 && (
            <Button onClick={handlePreview} disabled={!code.trim() || previewMutation.isPending} className="w-full h-12 bg-green-600 hover:bg-green-700" data-testid="button-lookup-code">
              {previewMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Looking up...</> : <><Search className="w-4 h-4 mr-2" /> Look Up Code</>}
            </Button>
          )}
          {!joined && step === 2 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} className="flex-1 h-12">Back</Button>
              <Button onClick={handleGeocode} disabled={geocoding || !destinationAddress.trim()} className="flex-1 h-12 bg-green-600 hover:bg-green-700" data-testid="button-join-next">
                {geocoding ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking...</> : "Next — See Fare"}
              </Button>
            </div>
          )}
          {!joined && step === 3 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} className="flex-1 h-12">Back</Button>
              <Button onClick={handleJoin} disabled={joinMutation.isPending} className="flex-1 h-12 bg-green-600 hover:bg-green-700" data-testid="button-confirm-join">
                {joinMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Joining...</> : `Join — $${fareEstimate ? (fareEstimate * 0.7).toFixed(2) : "..."}`}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
