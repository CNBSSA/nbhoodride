import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  X, MapPin, Users, Copy, CheckCircle, Star, Shield, Loader2,
  DollarSign, ChevronRight, Share2
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
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function AddressInput({
  value, onChange, onSelect, placeholder, label,
}: {
  value: string; onChange: (v: string) => void; onSelect: (s: AddressSuggestion) => void;
  placeholder: string; label: string;
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

// ── SharedScheduleSheet ────────────────────────────────────────────────────────

interface SharedScheduleSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number; address: string };
  nearbyDrivers: any[];
}

export default function SharedScheduleSheet({
  isOpen, onClose, userLocation, nearbyDrivers,
}: SharedScheduleSheetProps) {
  type Step = "route" | "driver" | "confirm" | "done";
  const [step, setStep] = useState<Step>("route");
  const [pickup, setPickup] = useState<Stop>({ address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng });
  const [destination, setDestination] = useState<Stop>({ address: "", lat: null, lng: null });
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [fareEstimate, setFareEstimate] = useState<any>(null);
  const [calculatingFare, setCalculatingFare] = useState(false);
  const [scheduleCode, setScheduleCode] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);

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
    };
  });

  const selectedDriver = drivers.find(d => d.id === selectedDriverId);

  const selectDriver = async (driverId: string) => {
    setSelectedDriverId(driverId);
    setCalculatingFare(true);
    if (pickup.lat && pickup.lng && destination.lat && destination.lng) {
      const dist = haversineMiles(pickup.lat, pickup.lng, destination.lat, destination.lng) * 1.3;
      const dur = Math.round((dist / 25) * 60);
      try {
        const res = await apiRequest('POST', '/api/rides/calculate-fare', { distance: dist, duration: dur, driverId });
        const data = await res.json();
        setFareEstimate(data);
      } catch { setFareEstimate(null); }
    }
    setCalculatingFare(false);
    setStep("confirm");
  };

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/rides/create-shared-schedule', {
        pickupLocation: { lat: pickup.lat!, lng: pickup.lng!, address: pickup.address },
        destination: { lat: destination.lat!, lng: destination.lng!, address: destination.address },
        driverId: selectedDriverId,
        estimatedFare: fareEstimate?.total || 0,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      setScheduleCode(data.scheduleCode);
      setStep("done");
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Unable to create shared schedule. Please try again.", variant: "destructive" });
    },
  });

  const copyCode = () => {
    navigator.clipboard.writeText(scheduleCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  const reset = () => {
    setStep("route");
    setPickup({ address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng });
    setDestination({ address: "", lat: null, lng: null });
    setSelectedDriverId("");
    setFareEstimate(null);
    setScheduleCode("");
    setCodeCopied(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col">
      <div className="flex-1 bg-black/50" onClick={() => { if (step !== "done") { onClose(); reset(); } }} />
      <div className="bg-white rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "92dvh" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-600" />
              <h2 className="text-base font-bold text-gray-900">Shared Schedule</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Book your ride, get a code, share it with up to 2 friends. Everyone gets 30% off if someone joins.</p>
          </div>
          <button onClick={() => { onClose(); reset(); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Step indicator */}
        {step !== "done" && (
          <div className="flex items-center gap-1 px-4 py-2">
            {(["route", "driver", "confirm"] as Step[]).map(s => (
              <div key={s} className={`flex-1 h-1 rounded-full ${step === s || (["driver", "confirm"].indexOf(step) > ["driver", "confirm"].indexOf(s as any)) || (step === "confirm" && s === "driver") || (step === "confirm" && s === "route") || (step === "driver" && s === "route") ? "bg-purple-500" : "bg-gray-200"}`} />
            ))}
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">

          {/* ── STEP 1: Route ── */}
          {step === "route" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Your pickup and destination</p>
              <AddressInput
                value={pickup.address}
                onChange={v => setPickup({ address: v, lat: null, lng: null })}
                onSelect={s => setPickup({ address: s.label, lat: s.lat, lng: s.lng })}
                placeholder="Your pickup location"
                label="Your pickup"
              />
              <AddressInput
                value={destination.address}
                onChange={v => setDestination({ address: v, lat: null, lng: null })}
                onSelect={s => setDestination({ address: s.label, lat: s.lat, lng: s.lng })}
                placeholder="Where are you going?"
                label="Your destination"
              />
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-700">
                Friends who join can have their own destination. <span className="font-semibold">30% discount for everyone</span> if at least 1 friend joins!
              </div>
              <Button
                className="w-full bg-purple-600 hover:bg-purple-700"
                disabled={!pickup.lat || !pickup.lng || !destination.lat || !destination.lng}
                onClick={() => setStep("driver")}
              >
                Pick a Driver <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── STEP 2: Driver ── */}
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
                  className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-purple-50 rounded-xl border border-gray-200 hover:border-purple-300 transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 text-purple-700 font-bold text-sm">
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
              <Button variant="outline" className="w-full" onClick={() => setStep("route")}>Back</Button>
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === "confirm" && selectedDriver && (
            <div className="space-y-4">
              <div className="bg-purple-50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-sm text-purple-900">Your Route</span>
                </div>
                <div className="text-xs text-gray-700 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                    <span className="truncate">{pickup.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0" />
                    <span className="truncate">{destination.address}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-bold text-sm flex-shrink-0">
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
                    <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  ) : (
                    <>
                      <p className="font-bold text-gray-900">${fareEstimate?.total?.toFixed(2) || "—"}</p>
                      <p className="text-xs text-purple-500 font-medium">→ ${ fareEstimate ? (fareEstimate.total * 0.7).toFixed(2) : "—"} if joined</p>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                <DollarSign className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>You pay full fare now. <span className="font-semibold">If someone joins, you both get 30% back</span> — a credit applied when the driver accepts.</span>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("driver")}>Back</Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={bookMutation.isPending || calculatingFare}
                  onClick={() => bookMutation.mutate()}
                >
                  {bookMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                  Create Schedule
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Done — show schedule code ── */}
          {step === "done" && (
            <div className="space-y-5 py-2">
              <div className="text-center">
                <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-8 h-8 text-purple-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Ride Requested!</h3>
                <p className="text-sm text-gray-500 mt-1">Share this code with friends so they can join your ride.</p>
              </div>

              {/* Big schedule code display */}
              <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl p-6 text-center shadow-lg">
                <p className="text-purple-200 text-xs font-medium mb-2 tracking-wider uppercase">Your Schedule Code</p>
                <p className="text-white text-4xl font-black tracking-widest mb-4">{scheduleCode}</p>
                <button
                  onClick={copyCode}
                  className="flex items-center gap-2 mx-auto bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                >
                  {codeCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {codeCopied ? "Copied!" : "Copy Code"}
                </button>
              </div>

              <div className="bg-purple-50 rounded-xl p-4 space-y-2 text-xs text-purple-800">
                <div className="flex items-center gap-2 font-semibold">
                  <Share2 className="w-4 h-4" /> How it works
                </div>
                <ul className="space-y-1.5 ml-6 list-disc text-gray-600">
                  <li>Share <span className="font-semibold text-purple-700">{scheduleCode}</span> with up to 2 friends.</li>
                  <li>Friends tap "Join Schedule" and enter the code.</li>
                  <li>If at least 1 friend joins, <span className="font-semibold">everyone gets 30% off</span>.</li>
                  <li>Each person pays for their own ride to their own destination.</li>
                </ul>
              </div>

              <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => { onClose(); reset(); }}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
