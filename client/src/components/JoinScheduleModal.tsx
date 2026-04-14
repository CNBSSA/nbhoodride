import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  X, MapPin, Users, CheckCircle, Loader2, Tag, ChevronRight, DollarSign
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
        className="h-10 rounded-xl text-sm border-gray-200 focus:border-purple-400"
        autoComplete="off"
      />
      {show && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={e => { e.preventDefault(); onSelect(s); setShow(false); setSuggestions([]); }}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-purple-50 text-left border-b border-gray-50 last:border-0"
            >
              <MapPin className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-gray-700 leading-snug line-clamp-2">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface JoinScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number; address: string };
}

interface GroupInfo {
  group: {
    id: string;
    scheduleCode: string;
    maxSlots: number;
    filledSlots: number;
    status: string;
    groupType: string;
  };
  organizerName: string;
  spotsLeft: number;
  rides: Array<{ pickupLocation: any; destinationLocation: any; estimatedFare: string }>;
}

export default function JoinScheduleModal({
  isOpen, onClose, userLocation,
}: JoinScheduleModalProps) {
  type Step = "code" | "preview" | "route" | "confirm" | "done";
  const [step, setStep] = useState<Step>("code");
  const [codeInput, setCodeInput] = useState("");
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [pickup, setPickup] = useState<Stop>({ address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng });
  const [destination, setDestination] = useState<Stop>({ address: "", lat: null, lng: null });
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [calculatingFare, setCalculatingFare] = useState(false);

  const { toast } = useToast();

  function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const lookupCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) { toast({ title: "Enter a code", description: "Please enter a schedule code like PG-XXXXXX.", variant: "destructive" }); return; }
    setLookupLoading(true);
    try {
      const res = await apiRequest('GET', `/api/rides/schedule/${code}`);
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Code Not Found", description: err.message || "No schedule found with that code.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setGroupInfo(data);
      setStep("preview");
    } catch {
      toast({ title: "Error", description: "Could not look up that code. Try again.", variant: "destructive" });
    } finally {
      setLookupLoading(false);
    }
  };

  const goToRoute = async () => {
    setStep("route");
  };

  const calculateAndConfirm = async () => {
    if (!pickup.lat || !pickup.lng || !destination.lat || !destination.lng) {
      toast({ title: "Select locations", description: "Please pick your pickup and destination from the suggestions.", variant: "destructive" });
      return;
    }
    setCalculatingFare(true);
    const dist = haversineMiles(pickup.lat, pickup.lng, destination.lat, destination.lng) * 1.3;
    const dur = Math.round((dist / 25) * 60);
    const raw = Math.max(7.65, Math.min(100, 4.0 + 0.29 * dur + 0.90 * dist));
    setFareEstimate(parseFloat(raw.toFixed(2)));
    setCalculatingFare(false);
    setStep("confirm");
  };

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/rides/join-schedule', {
        scheduleCode: codeInput.trim().toUpperCase(),
        pickupLocation: { lat: pickup.lat!, lng: pickup.lng!, address: pickup.address },
        destination: { lat: destination.lat!, lng: destination.lng!, address: destination.address },
        estimatedFare: fareEstimate || 0,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to join");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      setStep("done");
    },
    onError: (err: any) => {
      toast({ title: "Could Not Join", description: err.message || "Unable to join this schedule.", variant: "destructive" });
    },
  });

  const reset = () => {
    setStep("code");
    setCodeInput("");
    setGroupInfo(null);
    setPickup({ address: userLocation.address, lat: userLocation.lat, lng: userLocation.lng });
    setDestination({ address: "", lat: null, lng: null });
    setFareEstimate(null);
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
              <Tag className="w-5 h-5 text-purple-600" />
              <h2 className="text-base font-bold text-gray-900">Join a Schedule</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Enter a PG-XXXXXX code shared with you.</p>
          </div>
          <button onClick={() => { onClose(); reset(); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* ── Enter code ── */}
          {step === "code" && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">Enter the schedule code</p>
              <Input
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                placeholder="PG-XXXXXX"
                className="h-12 rounded-xl text-center text-xl font-bold tracking-widest border-purple-200 focus:border-purple-500"
                maxLength={9}
                autoFocus
              />
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-700">
                Ask the ride organizer for their 9-character code that starts with <span className="font-bold">PG-</span>
              </div>
              <Button
                className="w-full bg-purple-600 hover:bg-purple-700"
                disabled={lookupLoading || codeInput.length < 3}
                onClick={lookupCode}
              >
                {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Look Up Schedule
              </Button>
            </div>
          )}

          {/* ── Preview schedule ── */}
          {step === "preview" && groupInfo && (
            <div className="space-y-4">
              <div className="bg-purple-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-sm text-purple-900">Schedule {groupInfo.group.scheduleCode}</span>
                  <span className="ml-auto text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full font-medium">
                    {groupInfo.spotsLeft} spot{groupInfo.spotsLeft !== 1 ? 's' : ''} left
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                    <span>Organized by <span className="font-semibold">{groupInfo.organizerName}</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                    <span>{groupInfo.group.filledSlots}/{groupInfo.group.maxSlots} riders booked</span>
                  </div>
                </div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-xs text-green-800 flex items-start gap-2">
                <DollarSign className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-600" />
                <span><span className="font-semibold">30% discount</span> — because you're joining, everyone in this schedule (including the organizer) gets 30% off their fare!</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("code")}>Back</Button>
                <Button className="flex-1 bg-purple-600 hover:bg-purple-700" onClick={goToRoute}>
                  Set My Route <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Enter own route ── */}
          {step === "route" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Your pickup & destination</p>
              <p className="text-xs text-gray-500">Each rider can have their own destination.</p>
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
              <div className="flex gap-2 mt-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("preview")}>Back</Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={!pickup.lat || !pickup.lng || !destination.lat || !destination.lng || calculatingFare}
                  onClick={calculateAndConfirm}
                >
                  {calculatingFare ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Review Fare <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Confirm ── */}
          {step === "confirm" && (
            <div className="space-y-4">
              <div className="bg-purple-50 rounded-xl p-4 space-y-2">
                <p className="font-semibold text-sm text-purple-900 mb-2">Confirm Your Ride</p>
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

              {fareEstimate !== null && (
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-500 mb-1">Your fare (30% discount already applied)</p>
                  <p className="text-3xl font-black text-purple-700">${(fareEstimate * 0.70).toFixed(2)}</p>
                  <p className="text-xs text-gray-400 line-through mt-0.5">${fareEstimate.toFixed(2)} standard</p>
                </div>
              )}

              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                <DollarSign className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Virtual PG Card will be charged when the driver accepts the ride.</span>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("route")}>Back</Button>
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={joinMutation.isPending}
                  onClick={() => joinMutation.mutate()}
                >
                  {joinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                  Join Schedule
                </Button>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === "done" && (
            <div className="space-y-5 py-4 text-center">
              <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">You're In!</h3>
                <p className="text-sm text-gray-500 mt-1">You've joined the shared schedule. Your driver will be notified.</p>
              </div>
              <div className="bg-green-50 rounded-xl p-4 text-sm text-green-800">
                <span className="font-semibold">30% discount applied</span> — everyone in this schedule saves.
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
