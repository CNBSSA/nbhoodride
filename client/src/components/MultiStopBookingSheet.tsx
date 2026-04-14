import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Plus, X, Navigation, DollarSign, Shield, Loader2, CheckCircle, Trash2 } from "lucide-react";

interface Stop {
  address: string;
  lat: number | null;
  lng: number | null;
}

interface Driver {
  id: string;
  name: string;
  rating: number;
  vehicle: string;
  estimatedTime: string;
  estimatedFare: string;
  isVerifiedNeighbor: boolean;
}

interface MultiStopBookingSheetProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: Driver[];
  userLocation: { lat: number; lng: number; address: string };
}

const MAX_STOPS = 3;

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

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateFareForRoute(stops: Stop[], dest: Stop): number {
  // Sum haversine distances between consecutive stops including final destination
  const allPoints = stops.filter((s) => s.lat !== null);
  if (allPoints.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < allPoints.length - 1; i++) {
    dist += haversineMiles(allPoints[i].lat!, allPoints[i].lng!, allPoints[i + 1].lat!, allPoints[i + 1].lng!);
  }
  const roadDist = dist * 1.3;
  const duration = Math.round((roadDist / 25) * 60);
  return Math.max(5, 2.5 + roadDist * 1.5 + duration * 0.3);
}

export default function MultiStopBookingSheet({ isOpen, onClose, drivers, userLocation }: MultiStopBookingSheetProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stops, setStops] = useState<Stop[]>([
    { address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng },
    { address: "", lat: null, lng: null },
  ]);
  const [destination, setDestination] = useState<Stop>({ address: "", lat: null, lng: null });
  const [selectedDriver, setSelectedDriver] = useState("");
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setStops([
        { address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng },
        { address: "", lat: null, lng: null },
      ]);
      setDestination({ address: "", lat: null, lng: null });
      setSelectedDriver("");
      setFareEstimate(null);
    }
  }, [isOpen, userLocation]);

  const bookMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/rides/multi-stop", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Multi-Stop Ride Booked!", description: "Your driver will pick up all passengers in order." });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      onClose();
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const updateStop = (index: number, address: string) => {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, address, lat: null, lng: null } : s)));
  };

  const addStop = () => {
    if (stops.length < MAX_STOPS) {
      setStops((prev) => [...prev, { address: "", lat: null, lng: null }]);
    }
  };

  const removeStop = (index: number) => {
    if (index === 0) return;
    setStops((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGeocodeAll = async () => {
    setGeocoding(true);
    const geocoded = await Promise.all(
      stops.map(async (s) => {
        if (s.lat !== null) return s;
        const coords = await geocode(s.address);
        return coords ? { ...s, ...coords } : s;
      })
    );
    const destCoords = destination.lat !== null ? destination : { ...destination, ...(await geocode(destination.address)) };
    setStops(geocoded);
    setDestination(destCoords);
    const allStopsValid = geocoded.every((s) => s.lat !== null && s.address.trim());
    if (!allStopsValid || !destCoords.lat) {
      toast({ title: "Address Not Found", description: "Please check all addresses and try again.", variant: "destructive" });
      setGeocoding(false);
      return;
    }
    const allForFare = [...geocoded, destCoords];
    const fare = estimateFareForRoute(allForFare, destCoords);
    setFareEstimate(fare);
    setGeocoding(false);
    setStep(2);
  };

  const handleConfirm = () => {
    if (!selectedDriver) return;
    const [firstStop, ...additionalStops] = stops;
    bookMutation.mutate({
      pickupLocation: { lat: firstStop.lat, lng: firstStop.lng, address: firstStop.address },
      destinationLocation: { lat: destination.lat, lng: destination.lng, address: destination.address },
      pickupStops: additionalStops.map((s) => ({ lat: s.lat, lng: s.lng, address: s.address })),
      driverId: selectedDriver,
      estimatedFare: fareEstimate?.toFixed(2),
      paymentMethod: "card",
      rideType: "multi_stop",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold">Multi-Stop Ride</h2>
            <p className="text-xs text-gray-500">You pay the full route · max 3 stops</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-multistop">
            <X className="w-4 h-4 text-gray-400" />
          </Button>
        </div>

        {/* Step pills */}
        <div className="flex gap-1 px-4 pb-3 flex-shrink-0">
          {["Stops", "Destination", "Driver", "Confirm"].map((label, i) => (
            <div key={label} className={`flex-1 h-1 rounded-full ${step > i ? "bg-blue-600" : step === i + 1 ? "bg-blue-400" : "bg-gray-200"}`} />
          ))}
        </div>

        <CardContent className="overflow-y-auto p-4 space-y-4 flex-1">
          {/* Step 1 — Stops */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Add pickup stops (in order)</p>
              {stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white ${index === 0 ? "bg-blue-600" : "bg-orange-500"}`}>
                    {index === 0 ? <Navigation className="w-3 h-3" /> : index + 1}
                  </div>
                  <Input
                    value={stop.address}
                    onChange={(e) => updateStop(index, e.target.value)}
                    placeholder={index === 0 ? "Your pickup location" : `Stop ${index + 1} address`}
                    disabled={index === 0}
                    className="flex-1 text-sm"
                    data-testid={`input-stop-${index}`}
                  />
                  {index > 0 && (
                    <button onClick={() => removeStop(index)} className="text-red-400 p-1" data-testid={`button-remove-stop-${index}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {stops.length < MAX_STOPS && (
                <button onClick={addStop} className="flex items-center gap-2 text-blue-600 text-sm font-medium px-1" data-testid="button-add-stop">
                  <Plus className="w-4 h-4" /> Add another stop
                </button>
              )}

              <Separator />
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500" /> Final Destination (shared by all)
              </p>
              <Input
                value={destination.address}
                onChange={(e) => setDestination({ address: e.target.value, lat: null, lng: null })}
                placeholder="Where is everyone going?"
                data-testid="input-multistop-destination"
              />
            </div>
          )}

          {/* Step 2 — Fare preview + driver selection */}
          {step === 2 && fareEstimate && (
            <div className="space-y-4">
              <Card className="bg-gradient-to-r from-blue-50 to-green-50 border-blue-200">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span className="font-semibold text-sm">Full Route Fare</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">${fareEstimate.toFixed(2)}</p>
                  <p className="text-xs text-gray-500 mt-1">Covers {stops.length} pickup{stops.length > 1 ? "s" : ""} + final destination</p>
                  <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> No surge pricing
                  </p>
                </CardContent>
              </Card>

              <div>
                <p className="text-sm font-semibold mb-2">Route Summary</p>
                <div className="space-y-1">
                  {stops.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold ${i === 0 ? "bg-blue-600" : "bg-orange-500"}`}>
                        {i + 1}
                      </div>
                      <span className="truncate">{s.address}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <MapPin className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="truncate font-medium">{destination.address}</span>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Choose Your Driver</p>
                <div className="space-y-2">
                  {drivers.map((driver) => (
                    <label key={driver.id} className={`flex items-center p-3 rounded-xl cursor-pointer transition-all border-2 ${selectedDriver === driver.id ? "border-blue-400 bg-blue-50" : "border-transparent bg-white shadow-sm"}`} data-testid={`driver-option-${driver.id}`}>
                      <input type="radio" name="driver" value={driver.id} checked={selectedDriver === driver.id} onChange={(e) => setSelectedDriver(e.target.value)} className="sr-only" />
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mr-3 flex-shrink-0 ${selectedDriver === driver.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        {driver.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{driver.name}</p>
                        <p className="text-xs text-gray-500">★ {driver.rating.toFixed(1)} · {driver.estimatedTime}</p>
                      </div>
                      {selectedDriver === driver.id && <CheckCircle className="w-4 h-4 text-blue-600" />}
                    </label>
                  ))}
                  {drivers.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No drivers nearby right now</p>}
                </div>
              </div>
            </div>
          )}

          {/* Step 3+ handled below (just confirm in footer) */}
        </CardContent>

        <div className="p-4 border-t flex-shrink-0 space-y-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
          {step === 1 && (
            <Button onClick={handleGeocodeAll} disabled={geocoding || !destination.address || stops.some((s, i) => i > 0 && !s.address)} className="w-full h-12" data-testid="button-multistop-next">
              {geocoding ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculating route...</> : "Next — Calculate Fare"}
            </Button>
          )}
          {step === 2 && (
            <div className="space-y-2">
              {fareEstimate && selectedDriver && (
                <div className="flex justify-between text-xs text-gray-500 px-1">
                  <span>Paid via Virtual PG Card</span>
                  <span className="font-bold text-sm text-gray-900">${fareEstimate.toFixed(2)}</span>
                </div>
              )}
              <Button onClick={handleConfirm} disabled={!selectedDriver || bookMutation.isPending} className="w-full h-12 font-semibold" data-testid="button-multistop-confirm">
                {bookMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Booking...</> : fareEstimate ? `Confirm — $${fareEstimate.toFixed(2)}` : "Confirm Multi-Stop Ride"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
