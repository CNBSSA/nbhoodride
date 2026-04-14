import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  X, MapPin, Plus, Trash2, Navigation, Star, Shield, Loader2,
  Route, DollarSign, ChevronRight, CheckCircle
} from "lucide-react";

interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
}

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
  estimatedFare: string;
  estimatedTime: string;
  isVerifiedNeighbor: boolean;
  profileImage?: string;
}

interface MultiStopBookingSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number; address: string };
  nearbyDrivers: any[];
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeTotalMiles(stops: Stop[]): number {
  let total = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (a.lat && a.lng && b.lat && b.lng) {
      total += haversineMiles(a.lat, a.lng, b.lat, b.lng);
    }
  }
  return total;
}

function AddressInput({
  value,
  onChange,
  onSelect,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSuggestion) => void;
  placeholder: string;
  label: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [show, setShow] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (v: string) => {
    onChange(v);
    if (timer) clearTimeout(timer);
    if (v.length < 3) { setSuggestions([]); setShow(false); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(v)}&limit=5&countrycodes=us`,
          { headers: { 'User-Agent': 'PGRide-Community-Rideshare/1.0' } }
        );
        const data = await res.json();
        setSuggestions(data.map((r: any) => ({ label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) })));
        setShow(true);
      } catch { setSuggestions([]); }
    }, 300);
    setTimer(t);
  };

  return (
    <div className="relative">
      <label className="text-xs text-gray-500 font-medium mb-1 block">{label}</label>
      <Input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        className="h-10 rounded-xl text-sm border-gray-200 focus:border-blue-400"
        autoComplete="off"
      />
      {show && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={e => { e.preventDefault(); onSelect(s); setShow(false); setSuggestions([]); }}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-blue-50 text-left border-b border-gray-50 last:border-0"
            >
              <MapPin className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-gray-700 leading-snug line-clamp-2">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MultiStopBookingSheet({
  isOpen,
  onClose,
  userLocation,
  nearbyDrivers,
}: MultiStopBookingSheetProps) {
  // Step: "stops" → "destination" → "driver" → "confirm"
  type Step = "stops" | "destination" | "driver" | "confirm";
  const [step, setStep] = useState<Step>("stops");

  // Pickup stops (start with user's current location as stop 1)
  const [stops, setStops] = useState<Stop[]>([
    { address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng },
    { address: "", lat: null, lng: null },
  ]);

  const [destination, setDestination] = useState<Stop>({ address: "", lat: null, lng: null });
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [fareEstimate, setFareEstimate] = useState<any>(null);
  const [calculatingFare, setCalculatingFare] = useState(false);

  const { toast } = useToast();

  const drivers: Driver[] = nearbyDrivers.map((driver: any) => {
    const distMiles = haversineMiles(
      userLocation.lat, userLocation.lng,
      driver.currentLocation?.lat ?? userLocation.lat,
      driver.currentLocation?.lng ?? userLocation.lng,
    );
    const roadMiles = distMiles * 1.3;
    const dur = Math.round((roadMiles / 25) * 60);
    const fare = Math.max(7.65, Math.min(100, 4.0 + 0.29 * dur + 0.90 * roadMiles));
    return {
      id: driver.userId,
      name: `${driver.user.firstName} ${driver.user.lastName?.[0] || ''}.`,
      rating: parseFloat(driver.user.rating) || 5.0,
      vehicle: driver.vehicles?.[0]
        ? `${driver.vehicles[0].year} ${driver.vehicles[0].make} ${driver.vehicles[0].model}`
        : "Vehicle",
      estimatedFare: `$${fare.toFixed(2)}`,
      estimatedTime: `~${Math.max(1, Math.round((distMiles * 1.3 / 25) * 60))} min`,
      isVerifiedNeighbor: driver.isVerifiedNeighbor,
      profileImage: driver.user.profileImageUrl,
    };
  });

  const selectedDriver = drivers.find(d => d.id === selectedDriverId);

  const addStop = () => {
    if (stops.length < 3) setStops(prev => [...prev, { address: "", lat: null, lng: null }]);
  };

  const removeStop = (i: number) => {
    setStops(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateStop = (i: number, s: AddressSuggestion) => {
    setStops(prev => prev.map((stop, idx) => idx === i ? { address: s.label, lat: s.lat, lng: s.lng } : stop));
  };

  const updateStopAddress = (i: number, address: string) => {
    setStops(prev => prev.map((stop, idx) => idx === i ? { ...stop, address, lat: null, lng: null } : stop));
  };

  const goToDestination = () => {
    const invalid = stops.some(s => !s.lat || !s.lng);
    if (invalid) {
      toast({ title: "Select pickup stops", description: "Pick a suggestion for each stop so we can route correctly.", variant: "destructive" });
      return;
    }
    setStep("destination");
  };

  const selectDriver = async (driverId: string) => {
    setSelectedDriverId(driverId);
    setCalculatingFare(true);
    // Compute total route distance: all stops + destination
    const allPoints = [
      ...stops.filter(s => s.lat && s.lng) as Array<{ lat: number; lng: number; address: string }>,
      ...(destination.lat && destination.lng ? [destination as { lat: number; lng: number; address: string }] : []),
    ];
    const totalMiles = routeTotalMiles(allPoints.map(p => ({ address: '', lat: p.lat, lng: p.lng })));
    const totalDur = Math.round((totalMiles * 1.3 / 25) * 60);
    try {
      const res = await apiRequest('POST', '/api/rides/calculate-fare', {
        distance: totalMiles * 1.3,
        duration: totalDur,
        driverId,
      });
      const data = await res.json();
      setFareEstimate(data);
    } catch {
      setFareEstimate(null);
    } finally {
      setCalculatingFare(false);
      setStep("confirm");
    }
  };

  const bookMutation = useMutation({
    mutationFn: async () => {
      const validStops = stops.filter(s => s.lat && s.lng).map(s => ({ lat: s.lat!, lng: s.lng!, address: s.address }));
      const res = await apiRequest('POST', '/api/rides/multi-stop', {
        pickupStops: validStops,
        destination: { lat: destination.lat!, lng: destination.lng!, address: destination.address },
        driverId: selectedDriverId,
        estimatedFare: fareEstimate?.total || 0,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      toast({ title: "Multi-Stop Ride Booked!", description: "Your driver has been notified of all pickup stops." });
      onClose();
      reset();
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Unable to book your ride. Please try again.", variant: "destructive" });
    },
  });

  const reset = () => {
    setStep("stops");
    setStops([
      { address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng },
      { address: "", lat: null, lng: null },
    ]);
    setDestination({ address: "", lat: null, lng: null });
    setSelectedDriverId("");
    setFareEstimate(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={() => { onClose(); reset(); }} />

      {/* Sheet */}
      <div className="bg-white rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "92dvh" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Route className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-bold text-gray-900">Multi-Stop Ride</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Up to 3 pickup stops → one shared destination. You pay the full route.</p>
          </div>
          <button onClick={() => { onClose(); reset(); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-4 py-2">
          {(["stops", "destination", "driver", "confirm"] as Step[]).map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${step === s || (["destination", "driver", "confirm"].indexOf(step) > ["destination", "driver", "confirm"].indexOf(s)) ? "bg-blue-500" : "bg-gray-200"}`} />
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">

          {/* ── STEP 1: Pickup stops ── */}
          {step === "stops" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Where do you need to pick up passengers?</p>
              {stops.map((stop, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <AddressInput
                      value={stop.address}
                      onChange={v => updateStopAddress(i, v)}
                      onSelect={s => updateStop(i, s)}
                      placeholder={i === 0 ? "Your pickup location" : `Stop ${i + 1}`}
                      label={i === 0 ? "First pickup" : `Stop ${i + 1}`}
                    />
                  </div>
                  {i > 0 && (
                    <button onClick={() => removeStop(i)} className="mb-0.5 w-9 h-9 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              {stops.length < 3 && (
                <button onClick={addStop} className="flex items-center gap-2 text-blue-600 text-sm font-medium hover:text-blue-700">
                  <Plus className="w-4 h-4" /> Add another pickup stop
                </button>
              )}

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
                onClick={goToDestination}
              >
                Next: Set Destination <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── STEP 2: Shared destination ── */}
          {step === "destination" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Where is everyone going?</p>
              <AddressInput
                value={destination.address}
                onChange={v => setDestination({ address: v, lat: null, lng: null })}
                onSelect={s => setDestination({ address: s.label, lat: s.lat, lng: s.lng })}
                placeholder="Final destination for all passengers"
                label="Shared destination"
              />
              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                <span className="font-semibold">All passengers</span> will ride to this destination. You pay the full route fare.
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("stops")}>Back</Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={!destination.lat || !destination.lng}
                  onClick={() => setStep("driver")}
                >
                  Pick a Driver <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Select driver ── */}
          {step === "driver" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Select a driver</p>
              {drivers.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">No drivers nearby right now.</div>
              )}
              {drivers.map(driver => (
                <button
                  key={driver.id}
                  onClick={() => selectDriver(driver.id)}
                  className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-blue-50 rounded-xl border border-gray-200 hover:border-blue-300 transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-sm">
                    {driver.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-sm text-gray-900">{driver.name}</span>
                      {driver.isVerifiedNeighbor && <Shield className="w-3 h-3 text-blue-500" />}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{driver.vehicle}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      <span className="text-xs text-gray-600">{driver.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{driver.estimatedFare}</p>
                    <p className="text-xs text-gray-400">{driver.estimatedTime}</p>
                  </div>
                </button>
              ))}
              <Button variant="outline" className="w-full" onClick={() => setStep("destination")}>Back</Button>
            </div>
          )}

          {/* ── STEP 4: Confirm ── */}
          {step === "confirm" && selectedDriver && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Route className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm text-blue-900">Route Summary</span>
                </div>
                <div className="space-y-1.5">
                  {stops.filter(s => s.address).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-700">
                      <div className="w-4 h-4 bg-blue-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</div>
                      <span className="truncate">{s.address}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs text-gray-700 pt-1 border-t border-blue-200 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                    <span className="truncate font-medium">{destination.address}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                  {selectedDriver.name[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-sm">{selectedDriver.name}</span>
                    {selectedDriver.isVerifiedNeighbor && <Shield className="w-3 h-3 text-blue-500" />}
                  </div>
                  <p className="text-xs text-gray-500">{selectedDriver.vehicle}</p>
                </div>
                <div className="text-right">
                  {calculatingFare ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  ) : (
                    <>
                      <p className="font-bold text-gray-900">${fareEstimate?.total?.toFixed(2) || "—"}</p>
                      <p className="text-xs text-gray-400">Total fare</p>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                <DollarSign className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>You pay the full route fare. Virtual PG Card will be charged when the driver accepts.</span>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("driver")}>Back</Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={bookMutation.isPending || calculatingFare}
                  onClick={() => bookMutation.mutate()}
                >
                  {bookMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                  Confirm Ride
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
