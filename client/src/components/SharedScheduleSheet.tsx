import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { parseBookingErrorMessage } from "@shared/userFacingCopy";
import { useToast } from "@/hooks/use-toast";
import { X, Copy, CheckCircle, Users, Loader2, DollarSign, Shield, Star, Share2, Calendar as CalendarIcon, Clock, MapPin } from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

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
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledHour, setScheduledHour] = useState("11");
  const [scheduledMinute, setScheduledMinute] = useState("30");
  const [scheduledPeriod, setScheduledPeriod] = useState<"AM" | "PM">("PM");
  // Coordinates resolved when the rider picks a destination from autocomplete.
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Publish the group so other workers heading the same way can take a seat.
  // Default ON — a fuller car means everyone saves and drivers claim faster.
  const [openToOthers, setOpenToOthers] = useState(true);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Rides other workers are organizing right now — join one instead of
  // starting your own. Privacy-minimal listing (no pickup points).
  interface OpenGroup {
    groupId: string;
    destination: { address: string; lat: number; lng: number } | null;
    scheduledAt: string | null;
    seatsLeft: number;
    riders: number;
    discountActive: boolean;
    organizer: { firstName: string | null; lastInitial: string; rating: string | null } | null;
  }
  const { data: openGroupsData } = useQuery<{ groups: OpenGroup[] }>({
    queryKey: ["/api/rides/open-groups"],
    enabled: isOpen && step === 1,
  });
  const openGroups = openGroupsData?.groups ?? [];

  const joinOpenGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await apiRequest("POST", `/api/rides/open-groups/${groupId}/join`, {
        pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: userLocation.address },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides/scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rides/open-groups"] });
      toast({ title: "You're In! 🎉", description: "Seat taken — everyone's fare is now 30% off. Your ride shows under Upcoming." });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't Join", description: parseBookingErrorMessage(err.message), variant: "destructive" });
    },
  });

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
      setScheduledDate(undefined);
      setScheduledHour("11");
      setScheduledMinute("30");
      setScheduledPeriod("PM");
      setOpenToOthers(true);
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
      queryClient.invalidateQueries({ queryKey: ["/api/rides/scheduled"] });
    },
    onError: () => {
      toast({ title: "Booking Failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const handleDestinationSelect = (s: AddressSuggestion) => {
    setDestinationAddress(s.label);
    setDestCoords({ lat: s.lat, lng: s.lng });
  };

  const handleGeocodeAndNext = () => {
    if (!destCoords) {
      toast({ title: "Pick a destination", description: "Choose an address from the suggestions.", variant: "destructive" });
      return;
    }
    if (!scheduledDate) {
      toast({ title: "Pick shift end time", description: "Select a date and time when you leave work.", variant: "destructive" });
      return;
    }
    const fare = estimateFare(userLocation.lat, userLocation.lng, destCoords.lat, destCoords.lng);
    setFareEstimate(fare);
    setStep(2);
  };

  const buildScheduledAt = (): string | null => {
    if (!scheduledDate) return null;
    const hour24 =
      scheduledPeriod === "PM" && scheduledHour !== "12"
        ? parseInt(scheduledHour, 10) + 12
        : scheduledPeriod === "AM" && scheduledHour === "12"
          ? 0
          : parseInt(scheduledHour, 10);
    const scheduleDateTime = new Date(scheduledDate);
    scheduleDateTime.setHours(hour24, parseInt(scheduledMinute, 10), 0, 0);
    return scheduleDateTime.toISOString();
  };

  const handleConfirm = async () => {
    if (!destCoords) return;
    const scheduledAt = buildScheduledAt();
    if (!scheduledAt) {
      toast({ title: "When do you leave?", description: "Pick a shift-end date and time.", variant: "destructive" });
      return;
    }
    bookMutation.mutate({
      pickupLocation: { lat: userLocation.lat, lng: userLocation.lng, address: pickupAddress },
      destinationLocation: { lat: destCoords.lat, lng: destCoords.lng, address: destinationAddress },
      pickupInstructions,
      driverId: selectedDriver || null,
      estimatedFare: fareEstimate?.toFixed(2),
      paymentMethod: "card",
      rideType: "shared_schedule",
      scheduledAt,
      visibility: openToOthers ? "open" : "code",
    });
  };

  const shareCode = async () => {
    if (!generatedCode) return;
    const depart =
      scheduledDate &&
      `${format(scheduledDate, "MMM d")} at ${scheduledHour}:${scheduledMinute} ${scheduledPeriod}`;
    const text = `PG Ride — ride home after shift${depart ? ` (${depart})` : ""}. Join our group with code ${generatedCode} in the PG Ride app (Group code). Up to 3 of us, 30% off when 2+ join.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "PG Ride shift group", text });
        return;
      } catch {
        /* fall through */
      }
    }
    await navigator.clipboard.writeText(text);
    toast({ title: "Invite copied", description: "Paste in your work group chat." });
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
    <div className="fixed inset-0 z-[60] flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={step === 4 ? onClose : undefined} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold">Ride home with coworkers</h2>
            <p className="text-xs text-gray-500">Shift end time · share code · up to 3 riders</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-shared-schedule">
            <X className="w-4 h-4 text-gray-400" />
          </Button>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="flex gap-1 px-4 pb-3 flex-shrink-0">
            {["Route", "Driver", "Confirm", "Code"].map((label, i) => (
              <div key={label} className={`flex-1 h-1 rounded-full ${step > i ? "bg-blue-600" : step === i + 1 ? "bg-blue-400" : "bg-gray-200"}`} />
            ))}
          </div>
        )}

        <CardContent className="overflow-y-auto p-4 space-y-4 flex-1">
          {/* Step 1 — Route */}
          {step === 1 && (
            <div className="space-y-3">
              {/* Rides other workers are organizing — join one instead of
                  starting your own. Listing shows the shared destination,
                  time, seats, and organizer name only — never pickups. */}
              {openGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> Rides being organized near you
                  </p>
                  {openGroups.slice(0, 3).map((g) => (
                    <div key={g.groupId} className="border border-blue-200 bg-blue-50/60 rounded-xl p-3" data-testid={`open-group-${g.groupId}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            {g.destination?.address}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {g.scheduledAt ? format(new Date(g.scheduledAt), "EEE MMM d 'at' h:mm a") : ""}
                            {" · "}{g.riders} rider{g.riders === 1 ? "" : "s"} · {g.seatsLeft} seat{g.seatsLeft === 1 ? "" : "s"} left
                          </p>
                          {g.organizer && (
                            <p className="text-[11px] text-gray-400">
                              Organized by {g.organizer.firstName} {g.organizer.lastInitial}.
                              {" "}<Star className="w-3 h-3 inline text-yellow-500 fill-yellow-500" /> {parseFloat(g.organizer.rating || "5").toFixed(1)}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 shrink-0"
                          disabled={joinOpenGroupMutation.isPending}
                          onClick={() => joinOpenGroupMutation.mutate(g.groupId)}
                          data-testid={`button-join-open-${g.groupId}`}
                        >
                          {joinOpenGroupMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Join · 30% off"}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-[11px] text-gray-400 font-medium">or organize your own</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Your Pickup</label>
                <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Pickup address" data-testid="input-shared-pickup" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Your Destination</label>
                <AddressAutocomplete value={destinationAddress} onChange={(v) => { setDestinationAddress(v); setDestCoords(null); }} onSelect={handleDestinationSelect} placeholder="Where are you going?" data-testid="input-shared-destination" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Pickup Notes (optional)</label>
                <Textarea value={pickupInstructions} onChange={(e) => setPickupInstructions(e.target.value)} placeholder="e.g., Meet at main entrance" rows={2} data-testid="textarea-shared-instructions" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block flex items-center gap-1">
                  <Clock className="w-3 h-3" /> When does your shift end? (pickup time)
                </label>
                <div className="border rounded-lg p-2">
                  <Calendar
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                    className="mx-auto"
                  />
                  <div className="flex gap-2 mt-2">
                    <Select value={scheduledHour} onValueChange={setScheduledHour}>
                      <SelectTrigger className="flex-1" data-testid="shared-schedule-hour">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scheduledMinute} onValueChange={setScheduledMinute}>
                      <SelectTrigger className="w-20" data-testid="shared-schedule-minute">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["00", "15", "30", "45"].map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scheduledPeriod} onValueChange={(v) => setScheduledPeriod(v as "AM" | "PM")}>
                      <SelectTrigger className="w-20" data-testid="shared-schedule-period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AM">AM</SelectItem>
                        <SelectItem value="PM">PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scheduledDate && (
                    <p className="text-xs text-center text-muted-foreground mt-2">
                      <CalendarIcon className="w-3 h-3 inline mr-1" />
                      Leaving {format(scheduledDate, "EEE, MMM d")} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}
                    </p>
                  )}
                </div>
              </div>

              {/* Open-to-others toggle: fills empty seats with workers heading
                  the same way. Only coarse info is ever published. */}
              <div className="flex items-center justify-between border rounded-xl p-3">
                <div className="pr-3">
                  <p className="text-sm font-semibold">Open to other workers nearby</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {openToOthers
                      ? "Workers heading your way can take an empty seat — a fuller car means everyone saves. Only your destination, time, and first name are shown."
                      : "Invite-code only — just the people you share your code with can join."}
                  </p>
                </div>
                <Switch checked={openToOthers} onCheckedChange={setOpenToOthers} data-testid="switch-open-to-others" />
              </div>

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 flex items-start gap-2">
                  <Users className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-800">How this works</p>
                    <p className="text-[11px] text-blue-700 mt-0.5">Built for warehouse & shift teams (Amazon, Target, FedEx, etc.). You get a PG-XXXXXX code — text it to your group. Each coworker books their own ride home; everyone saves 30% when at least two join.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 2 — Driver selection */}
          {step === 2 && (
            <div className="space-y-4">
              {fareEstimate && (
                <Card className="bg-gradient-to-r from-blue-50 to-blue-50 border-blue-200">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-gray-500">Your fare (full price)</p>
                        <p className="text-2xl font-bold text-blue-700">${fareEstimate.toFixed(2)}</p>
                        <p className="text-xs text-green-600 font-medium">Drops to ${(fareEstimate * 0.7).toFixed(2)} when 1 friend joins</p>
                      </div>
                      <DollarSign className="w-8 h-8 text-blue-300" />
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
                    <label key={driver.id} className={`flex items-center p-3 rounded-xl cursor-pointer transition-all border-2 ${selectedDriver === driver.id ? "border-blue-400 bg-blue-50" : "border-transparent bg-white shadow-sm"}`} data-testid={`shared-driver-${driver.id}`}>
                      <input type="radio" name="shared-driver" value={driver.id} checked={selectedDriver === driver.id} onChange={(e) => setSelectedDriver(e.target.value)} className="sr-only" />
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mr-3 flex-shrink-0 ${selectedDriver === driver.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        {driver.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{driver.name}</p>
                        <p className="text-xs text-gray-500">
                          <Star className="w-3 h-3 inline text-yellow-500 fill-yellow-500" /> {driver.rating.toFixed(1)} · {driver.estimatedTime}
                        </p>
                      </div>
                      {selectedDriver === driver.id && <CheckCircle className="w-4 h-4 text-blue-600" />}
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
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Leave at:</span><span>{scheduledDate ? `${format(scheduledDate, "MMM d")} ${scheduledHour}:${scheduledMinute} ${scheduledPeriod}` : "—"}</span></div>
                <div className="flex gap-2"><span className="font-medium w-24 flex-shrink-0">Your fare:</span><span className="font-bold text-blue-700">${fareEstimate?.toFixed(2)}</span></div>
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

              <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-6 text-center">
                <p className="text-xs font-medium text-blue-500 mb-1 uppercase tracking-widest">Your Schedule Code</p>
                <p className="text-4xl font-black tracking-widest text-blue-800 font-mono">{generatedCode}</p>
              </div>

              <Button onClick={copyCode} variant="outline" className="w-full border-blue-300 text-blue-700 hover:bg-blue-50" data-testid="button-copy-schedule-code">
                {codeCopied ? <><CheckCircle className="w-4 h-4 mr-2 text-green-500" /> Copied!</> : <><Copy className="w-4 h-4 mr-2" /> Copy Code</>}
              </Button>
              <Button onClick={shareCode} className="w-full bg-blue-600 hover:bg-blue-700" data-testid="button-share-schedule-invite">
                <Share2 className="w-4 h-4 mr-2" /> Share invite with coworkers
              </Button>

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 space-y-1 text-xs text-blue-700">
                  {openToOthers && <p>✓ Your ride is also listed in-app — nearby workers heading your way can grab a seat</p>}
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
            <Button onClick={handleGeocodeAndNext} disabled={!destCoords} className="w-full h-12 bg-blue-600 hover:bg-blue-700" data-testid="button-shared-next-1">
              {"Next — Pick Driver"}
            </Button>
          )}
          {step === 2 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} className="flex-1 h-12">Back</Button>
              <Button onClick={() => setStep(3)} className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" data-testid="button-shared-next-2">Review & Confirm</Button>
            </div>
          )}
          {step === 3 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} className="flex-1 h-12">Back</Button>
              <Button onClick={handleConfirm} disabled={bookMutation.isPending} className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" data-testid="button-shared-confirm">
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
