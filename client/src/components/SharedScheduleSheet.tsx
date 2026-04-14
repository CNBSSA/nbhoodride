import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { X, Copy, CheckCircle, Users, Loader2, DollarSign, Shield, Star } from "lucide-react";

interface Driver {
  id: string;
  name: string;
  rating: number;
  vehicle: string;
  estimatedTime: string;
  estimatedFare: string;
  isVerifiedNeighbor: boolean;
}

interface SharedScheduleSheetProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: Driver[];
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

export default function SharedScheduleSheet({ isOpen, onClose, drivers, userLocation }: SharedScheduleSheetProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pickupAddress, setPickupAddress] = useState(userLocation.address);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [selectedDriver, setSelectedDriver] = useState("");
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setPickupAddress(userLocation.address);
      setDestinationAddress("");
      setPickupInstructions("");
      setSelectedDriver("");
      setFareEstimate(null);
      setGeneratedCode(null);
      setCodeCopied(false);
    }
  }, [isOpen, userLocation]);

  const bookMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/rides/create-shared-schedule", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      setGeneratedCode(data.scheduleCode);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const handleGeocodeAndNext = async () => {
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
    setStep(2);
  };

  const handleConfirm = async () => {
    const destCoords = await geocode(destinationAddress);
    if (!destCoords) return;
    bookMutation.mutate({
      pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: pickupAddress },
      destinationLocation: { lat: destCoords.lat, lng: destCoords.lng, address: destinationAddress },
      pickupInstructions,
      driverId: selectedDriver || null,
      estimatedFare: fareEstimate?.toFixed(2),
      paymentMethod: "card",
      rideType: "shared_schedule",
    });
  };

  const copyCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={step === 4 ? onClose : undefined} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold">Share My Schedule</h2>
            <p className="text-xs text-gray-500">Book your ride · share code · everyone saves 30%</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-shared-schedule">
            <X className="w-4 h-4 text-gray-400" />
          </Button>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="flex gap-1 px-4 pb-3 flex-shrink-0">
            {["Route", "Driver", "Confirm", "Code"].map((label, i) => (
              <div key={label} className={`flex-1 h-1 rounded-full ${step > i ? "bg-purple-600" : step === i + 1 ? "bg-purple-400" : "bg-gray-200"}`} />
            ))}
          </div>
        )}

        <CardContent className="overflow-y-auto p-4 space-y-4 flex-1">
          {/* Step 1 — Route */}
          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Your Pickup</label>
                <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Pickup address" data-testid="input-shared-pickup" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Your Destination</label>
                <Input value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} placeholder="Where are you going?" data-testid="input-shared-destination" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Pickup Notes (optional)</label>
                <Textarea value={pickupInstructions} onChange={(e) => setPickupInstructions(e.target.value)} placeholder="e.g., Meet at main entrance" rows={2} data-testid="textarea-shared-instructions" />
              </div>

              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-3 flex items-start gap-2">
                  <Users className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-purple-800">How this works</p>
                    <p className="text-[11px] text-purple-700 mt-0.5">After booking you'll get a PG-XXXXXX code. Share it with up to 2 friends. Everyone pays their own fare with 30% off the moment your first friend joins.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 2 — Driver selection */}
          {step === 2 && (
            <div className="space-y-4">
              {fareEstimate && (
                <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-gray-500">Your fare (full price)</p>
                        <p className="text-2xl font-bold text-purple-700">${fareEstimate.toFixed(2)}</p>
                        <p className="text-xs text-green-600 font-medium">Drops to ${(fareEstimate * 0.7).toFixed(2)} when 1 friend joins</p>
                      </div>
                      <DollarSign className="w-8 h-8 text-purple-300" />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> No surge pricing
                    </p>
                  </CardContent>
                </Card>
              )}

              <div>
                <p className="text-sm font-semibold mb-2">Choose a Driver (optional)</p>
                <p className="text-xs text-gray-400 mb-2">Skip to open the ride to all available drivers</p>
                <div className="space-y-2">
                  {drivers.map((driver) => (
                    <label key={driver.id} className={`flex items-center p-3 rounded-xl cursor-pointer transition-all border-2 ${selectedDriver === driver.id ? "border-purple-400 bg-purple-50" : "border-transparent bg-white shadow-sm"}`} data-testid={`shared-driver-${driver.id}`}>
                      <input type="radio" name="shared-driver" value={driver.id} checked={selectedDriver === driver.id} onChange={(e) => setSelectedDriver(e.target.value)} className="sr-only" />
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mr-3 flex-shrink-0 ${selectedDriver === driver.id ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        {driver.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{driver.name}</p>
                        <p className="text-xs text-gray-500">
                          <Star className="w-3 h-3 inline text-yellow-500 fill-yellow-500" /> {driver.rating.toFixed(1)} · {driver.estimatedTime}
                        </p>
                      </div>
                      {selectedDriver === driver.id && <CheckCircle className="w-4 h-4 text-purple-600" />}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Confirm */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Confirm Your Ride</p>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Pickup:</span><span className="truncate">{pickupAddress}</span></div>
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Destination:</span><span className="truncate">{destinationAddress}</span></div>
                {selectedDriver && <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Driver:</span><span>{drivers.find((d) => d.id === selectedDriver)?.name || selectedDriver}</span></div>}
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Your fare:</span><span className="font-bold text-purple-700">${fareEstimate?.toFixed(2)}</span></div>
              </div>

              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-3">
                  <p className="text-xs font-semibold text-green-800">What happens next</p>
                  <p className="text-[11px] text-green-700 mt-1">Your ride is booked at full price. Once 1 friend joins using your code, your fare automatically drops 30%. Payment is deducted when the driver accepts.</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 4 — Code display */}
          {step === 4 && generatedCode && (
            <div className="space-y-4 py-2">
              <div className="text-center">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p className="font-bold text-lg">Ride Scheduled!</p>
                <p className="text-sm text-gray-500">Share this code with up to 2 friends</p>
              </div>

              <div className="bg-purple-50 border-2 border-purple-300 rounded-2xl p-6 text-center">
                <p className="text-xs font-medium text-purple-500 mb-1 uppercase tracking-widest">Your Schedule Code</p>
                <p className="text-4xl font-black tracking-widest text-purple-800 font-mono">{generatedCode}</p>
              </div>

              <Button onClick={copyCode} variant="outline" className="w-full border-purple-300 text-purple-700 hover:bg-purple-50" data-testid="button-copy-schedule-code">
                {codeCopied ? <><CheckCircle className="w-4 h-4 mr-2 text-green-500" /> Copied!</> : <><Copy className="w-4 h-4 mr-2" /> Copy Code</>}
              </Button>

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 space-y-1 text-xs text-blue-700">
                  <p>✓ Code is open until your driver accepts</p>
                  <p>✓ Up to 2 friends can join with their own pickup + destination</p>
                  <p>✓ Everyone gets 30% off the moment 1 friend joins</p>
                  <p>✓ Driver earns more — it's a win for the whole community</p>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>

        {/* Footer actions */}
        <div className="p-4 border-t flex-shrink-0 space-y-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
          {step === 1 && (
            <Button onClick={handleGeocodeAndNext} disabled={geocoding || !destinationAddress.trim()} className="w-full h-12 bg-purple-600 hover:bg-purple-700" data-testid="button-shared-next-1">
              {geocoding ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculating...</> : "Next — Pick Driver"}
            </Button>
          )}
          {step === 2 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} className="flex-1 h-12">Back</Button>
              <Button onClick={() => setStep(3)} className="flex-1 h-12 bg-purple-600 hover:bg-purple-700" data-testid="button-shared-next-2">Review & Confirm</Button>
            </div>
          )}
          {step === 3 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} className="flex-1 h-12">Back</Button>
              <Button onClick={handleConfirm} disabled={bookMutation.isPending} className="flex-1 h-12 bg-purple-600 hover:bg-purple-700" data-testid="button-shared-confirm">
                {bookMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Booking...</> : "Book & Get Code"}
              </Button>
            </div>
          )}
          {step === 4 && (
            <Button onClick={onClose} className="w-full h-12" data-testid="button-shared-done">Done</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
