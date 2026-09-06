import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SheetPortal } from "@/components/SheetPortal";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { AddressSuggestion } from "@/hooks/useGeocode";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { NativeTimeSelects } from "@/components/NativeTimeSelects";
import { AddCardBanner } from "@/components/AddCardBanner";
import { AddPhoneBanner } from "@/components/AddPhoneBanner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { parseBookingErrorMessage } from "@shared/userFacingCopy";
import { checkScheduleTime, MIN_SCHEDULE_LEAD_HOURS } from "@shared/schedulingPolicy";
import { estimateRoute, MAX_RIDE_STOPS } from "@shared/routeEstimate";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, Clock, Search, X, Users, Repeat } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format, addDays } from "date-fns";
import {
  PLAN_DAY_LABELS, WEEKDAYS, WEEKLY_PLAN_DISCOUNT, planFare, weeklyTotal, nextPlanOccurrence, describePlanDays, describePlanTime,
} from "@shared/weeklyPlan";
import { useAnalytics } from "@/hooks/useAnalytics";

interface Driver {
  id: string;
  name: string;
  rating: number;
  vehicle: string;
  estimatedTime: string;
  estimatedFare: string;
  isVerifiedNeighbor: boolean;
  profileImage?: string;
  phone?: string;
}

interface FareEstimate {
  baseFare: number;
  timeCharge: number;
  distanceCharge: number;
  surgeAdjustment: number;
  subtotal: number;
  total: number;
  promoDiscount?: number;
  promoRidesRemaining?: number;
  totalAfterPromo?: number;
  formula: string;
}

interface ScheduleRideModalProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: Driver[];
  userLocation: { lat: number; lng: number; address: string };
}

export default function ScheduleRideModal({ 
  isOpen, 
  onClose, 
  drivers,
  userLocation 
}: ScheduleRideModalProps) {
  const [pickupAddress, setPickupAddress] = useState(userLocation.address);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [bookingType, setBookingType] = useState<"now" | "schedule">("schedule");
  const [scheduledDate, setScheduledDate] = useState<Date>();
  const [scheduledHour, setScheduledHour] = useState<string>("12");
  const [scheduledMinute, setScheduledMinute] = useState<string>("00");
  const [scheduledPeriod, setScheduledPeriod] = useState<"AM" | "PM">("PM");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [searchedDrivers, setSearchedDrivers] = useState<Driver[]>([]);
  const [wantsSharedRide, setWantsSharedRide] = useState(false);
  // Standing weekly plan: same route and time on the chosen days, booked
  // ahead by the server at a locked plan rate (shared/weeklyPlan.ts).
  const [weeklyPlan, setWeeklyPlan] = useState(false);
  const [planDays, setPlanDays] = useState<number[]>([...WEEKDAYS]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { trackRideSearch, trackRideBooked } = useAnalytics();

  useEffect(() => {
    if (isOpen) {
      trackRideSearch();
    }
  }, [isOpen, trackRideSearch]);

  // Search driver by phone number
  const searchDriverMutation = useMutation({
    mutationFn: async (phone: string) => {
      const response = await apiRequest('GET', `/api/drivers/search?phone=${encodeURIComponent(phone)}`);
      return response.json();
    },
    onSuccess: (data) => {
      // Swapping the visible driver list invalidates any prior selection —
      // otherwise a driver no longer shown stays silently pinned while every
      // visible radio (including "Open to all") renders unchecked.
      setSelectedDriver("");
      if (data && data.length > 0) {
        setSearchedDrivers(data);
        toast({
          title: "Driver Found",
          description: `Found ${data.length} driver(s) with that phone number.`,
        });
      } else {
        setSearchedDrivers([]);
        toast({
          title: "No Driver Found",
          description: "No driver found with that phone number.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Search Failed",
        description: "Unable to search for driver. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Calculate fare when destination changes
  const calculateFareMutation = useMutation({
    mutationFn: async ({ distance, duration, driverId }: { distance: number; duration: number; driverId?: string }) => {
      const response = await apiRequest('POST', '/api/rides/calculate-fare', { distance, duration, driverId });
      return response.json();
    },
    onSuccess: (data) => {
      setFareEstimate(data);
    }
  });

  // Book ride mutation
  const bookRideMutation = useMutation({
    mutationFn: async (rideData: any) => {
      const response = await apiRequest('POST', '/api/rides', rideData);
      return response.json();
    },
    onSuccess: async (data) => {
      trackRideBooked();
      if (bookingType === "schedule") {
        toast({
          title: "Ride Scheduled!",
          description: `Your ride has been scheduled for ${format(scheduledDate!, "MMM dd, yyyy")} at ${scheduledHour}:${scheduledMinute} ${scheduledPeriod}.`,
        });
      } else {
        toast({
          title: "Ride Booked!",
          description: "Your driver is on the way. You'll receive updates shortly.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rides/scheduled"] });
      onClose();
    },
    onError: (error: Error) => {
      // Surface the server's actual reason (service area, rate limit,
      // validation) — the old generic copy hid every real cause.
      toast({
        title: "Booking Failed",
        description: parseBookingErrorMessage(error.message),
        variant: "destructive",
      });
    }
  });

  // Start a standing weekly plan: the server books each day's ride ahead.
  const startPlanMutation = useMutation({
    mutationFn: async (planData: any) => {
      const response = await apiRequest('POST', '/api/rider/weekly-plans', planData);
      return response.json();
    },
    onSuccess: (data) => {
      trackRideBooked();
      const first = data?.upcoming?.[0]?.scheduledAt ? new Date(data.upcoming[0].scheduledAt) : null;
      toast({
        title: "Weekly ride set!",
        description: `${describePlanDays(planDays)} at ${describePlanTime(planHour24, parseInt(scheduledMinute))}, $${Number(data?.quote?.perRide ?? 0).toFixed(2)} per ride.${first ? ` First ride ${format(first, "EEE, MMM d")}.` : ""} Pause any time from your home screen.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rides/scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rider/weekly-plans"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Could not start your weekly ride",
        description: parseBookingErrorMessage(error.message),
        variant: "destructive",
      });
    }
  });

  const [destCoords, setDestCoords] = useState<{lat: number, lng: number} | null>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  // "Add a stop": extra destinations on the way, quoted over the whole route.
  const [stops, setStops] = useState<Array<{ address: string; lat: number; lng: number }>>([]);
  const [addingStop, setAddingStop] = useState(false);
  const [stopDraft, setStopDraft] = useState("");

  // Rider picks a destination from the autocomplete → resolve coords, compute
  // distance/duration, and kick off the fare estimate. No more single-shot
  // browser Nominatim guess.
  const handleDestinationSelect = (s: AddressSuggestion) => {
    setDestinationAddress(s.label);
    setDestCoords({ lat: s.lat, lng: s.lng });
    const { miles: distance, minutes: duration } = estimateRoute([userLocation, ...stops, s]);
    setEstimatedDistance(distance);
    setEstimatedDuration(duration);
    calculateFareMutation.mutate({ distance, duration, driverId: selectedDriver || undefined });
  };

  const requoteWithStops = (nextStops: Array<{ lat: number; lng: number }>) => {
    setStops(nextStops as Array<{ address: string; lat: number; lng: number }>);
    if (!destCoords) return;
    const { miles: distance, minutes: duration } = estimateRoute([userLocation, ...nextStops, destCoords]);
    setEstimatedDistance(distance);
    setEstimatedDuration(duration);
    calculateFareMutation.mutate({ distance, duration, driverId: selectedDriver || undefined });
  };
  const addStop = (s: AddressSuggestion) => {
    setAddingStop(false); setStopDraft("");
    requoteWithStops([...stops, { address: s.label, lat: s.lat, lng: s.lng }]);
  };
  const removeStop = (index: number) => requoteWithStops(stops.filter((_, i) => i !== index));

  useEffect(() => {
    if (selectedDriver && estimatedDistance && estimatedDuration) {
      calculateFareMutation.mutate({ distance: estimatedDistance, duration: estimatedDuration, driverId: selectedDriver });
    }
  }, [selectedDriver]);

  // Sync pickup address with userLocation changes
  useEffect(() => {
    if (isOpen && userLocation) {
      setPickupAddress(userLocation.address);
    }
  }, [isOpen, userLocation?.address]);

  const handleSearchDriver = () => {
    if (phoneSearch.trim()) {
      searchDriverMutation.mutate(phoneSearch.trim());
    }
  };

  const handleBookRide = () => {
    if (!destinationAddress) {
      toast({
        title: "Missing Destination",
        description: "Please enter a destination.",
        variant: "destructive",
      });
      return;
    }

    // For scheduled rides, driver selection is optional — open broadcast
    if (bookingType === "now" && !selectedDriver) {
      toast({
        title: "Select a Driver",
        description: "Please select a driver for an immediate booking.",
        variant: "destructive",
      });
      return;
    }

    if (!destCoords) {
      toast({
        title: "Address Not Found",
        description: "We couldn't locate that destination. Please enter a valid address.",
        variant: "destructive",
      });
      return;
    }

    if (bookingType === "schedule" && weeklyPlan) {
      if (planDays.length === 0) {
        toast({ title: "Pick your days", description: "Choose at least one day of the week for your plan.", variant: "destructive" });
        return;
      }
      startPlanMutation.mutate({
        label: "Weekly ride",
        pickup: { lat: userLocation.lat, lng: userLocation.lng, address: pickupAddress },
        destination: { lat: destCoords!.lat, lng: destCoords!.lng, address: destinationAddress },
        stops: stops.length > 0 ? stops : undefined,
        pickupInstructions,
        driverId: selectedDriver || undefined,
        days: planDays,
        departureHour: planHour24,
        departureMinute: parseInt(scheduledMinute),
        timezone: planTimezone,
        distance: estimatedDistance,
        duration: estimatedDuration,
      });
      return;
    }

    if (bookingType === "schedule" && !scheduledDate) {
      toast({
        title: "Missing Date",
        description: "Please select a date for your scheduled ride.",
        variant: "destructive",
      });
      return;
    }

    let scheduledAt = null;
    if (bookingType === "schedule" && scheduledDate) {
      const hour24 = scheduledPeriod === "PM" && scheduledHour !== "12" 
        ? parseInt(scheduledHour) + 12 
        : scheduledPeriod === "AM" && scheduledHour === "12"
        ? 0
        : parseInt(scheduledHour);
      
      const scheduleDateTime = new Date(scheduledDate);
      scheduleDateTime.setHours(hour24, parseInt(scheduledMinute), 0, 0);
      scheduledAt = scheduleDateTime.toISOString();
    }

    const rideData = {
      pickupLocation: {
        lat: userLocation.lat,
        lng: userLocation.lng,
        address: pickupAddress
      },
      destinationLocation: {
        lat: destCoords!.lat,
        lng: destCoords!.lng,
        address: destinationAddress
      },
      pickupInstructions,
      driverId: selectedDriver,
      estimatedFare: fareEstimate?.total || 0,
      distance: estimatedDistance,
      duration: estimatedDuration,
      stops: stops.length > 0 ? stops : undefined,
      scheduledAt,
      paymentMethod: 'card',
      wantsSharedRide,
    };

    bookRideMutation.mutate(rideData);
  };

  const availableDrivers = searchedDrivers.length > 0 ? searchedDrivers : drivers;

  // Live check of the chosen pickup time against the scheduling policy the
  // server enforces (minimum notice, booking horizon), so the rider sees why
  // the confirm button is disabled instead of a rejected request.
  const selectedScheduleTime = (() => {
    if (bookingType !== "schedule" || !scheduledDate) return null;
    const hour24 = scheduledPeriod === "PM" && scheduledHour !== "12"
      ? parseInt(scheduledHour) + 12
      : scheduledPeriod === "AM" && scheduledHour === "12"
      ? 0
      : parseInt(scheduledHour);
    const dt = new Date(scheduledDate);
    dt.setHours(hour24, parseInt(scheduledMinute), 0, 0);
    return dt;
  })();
  const planHour24 = scheduledPeriod === "PM" && scheduledHour !== "12"
    ? parseInt(scheduledHour) + 12
    : scheduledPeriod === "AM" && scheduledHour === "12"
    ? 0
    : parseInt(scheduledHour);
  const planPricing = fareEstimate ? planFare(fareEstimate.total) : null;
  // The rider's own clock decides what "5:30 PM" means; the server books in
  // that zone (Eastern for everyone in the service area).
  const planTimezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } })();
  const planFirstRide = weeklyPlan && planDays.length > 0
    ? nextPlanOccurrence({ days: planDays, departureHour: planHour24, departureMinute: parseInt(scheduledMinute), timezone: planTimezone })
    : undefined;
  const togglePlanDay = (d: number) =>
    setPlanDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  const scheduleTimeCheck = selectedScheduleTime && !weeklyPlan ? checkScheduleTime(selectedScheduleTime) : null;
  const scheduleTimeError = scheduleTimeCheck && !scheduleTimeCheck.valid ? scheduleTimeCheck.error : null;

  if (!isOpen) return null;

  return (
    <SheetPortal>
    <div className="fixed inset-0 z-[60] flex items-end justify-center max-w-[430px] mx-auto" style={{ height: "100dvh" }}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 w-full h-[calc(100dvh-1.5rem)] rounded-t-xl border-0 shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: "calc(100dvh - 1.5rem)" }}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Schedule a Ride</h2>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-schedule">
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <AddCardBanner />
          <AddPhoneBanner />
          {/* Ride Type Tabs */}
          <Tabs value={bookingType} onValueChange={(v) => setBookingType(v as "now" | "schedule")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="now" data-testid="tab-book-now">Book Now</TabsTrigger>
              <TabsTrigger value="schedule" data-testid="tab-schedule-later">Schedule Later</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Schedule Date & Time (only for scheduled rides) */}
          {bookingType === "schedule" && (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-4">
                {!weeklyPlan && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    Select Date
                  </label>
                  <Calendar
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0)) || date > addDays(new Date(), 30)}
                    className="rounded-md border"
                    data-testid="calendar-schedule-date"
                  />
                  <p className="text-xs text-muted-foreground">
                    Same-day scheduling works — pickup just needs to be at least {MIN_SCHEDULE_LEAD_HOURS} hours from now.
                  </p>
                </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Select Time
                  </label>
                  <NativeTimeSelects
                    hour={scheduledHour}
                    minute={scheduledMinute}
                    period={scheduledPeriod}
                    onHourChange={setScheduledHour}
                    onMinuteChange={setScheduledMinute}
                    onPeriodChange={setScheduledPeriod}
                    hourOptions={Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, "0"))}
                    testIds={{ hour: "select-hour", minute: "select-minute", period: "select-period" }}
                  />
                  {scheduledDate && !weeklyPlan && (
                    <p className="text-sm text-muted-foreground">
                      Pickup scheduled for: <strong>{format(scheduledDate, "MMM dd, yyyy")} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}</strong>
                    </p>
                  )}
                  {/* Standing weekly plan — the commuter's ride home */}
                  <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="weekly-plan-row">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <Repeat className="w-4 h-4 text-primary shrink-0" />
                          Make this my weekly ride
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Same pickup, same time, every week. We book each day ahead at a locked plan rate — {Math.round(WEEKLY_PLAN_DISCOUNT * 100)}% off. You pay per ride as usual and can pause any time.
                        </p>
                      </div>
                      <Switch checked={weeklyPlan} onCheckedChange={setWeeklyPlan} data-testid="toggle-weekly-plan" />
                    </div>
                    {weeklyPlan && (
                      <>
                        <div className="flex flex-wrap gap-1.5" data-testid="plan-days">
                          {PLAN_DAY_LABELS.map((label, d) => {
                            const on = planDays.includes(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                onClick={() => togglePlanDay(d)}
                                aria-pressed={on}
                                className={`min-w-[44px] h-10 px-2 rounded-full text-xs font-semibold border transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border"}`}
                                data-testid={`plan-day-${d}`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {planPricing && fareEstimate ? (
                          <p className="text-sm" data-testid="text-plan-price">
                            <strong>${planPricing.perRide.toFixed(2)} per ride</strong>
                            <span className="text-muted-foreground"> · about ${weeklyTotal(planPricing.perRide, planDays.length).toFixed(2)} a week for {describePlanDays(planDays) || "no days"} (one-off price ${fareEstimate.total.toFixed(2)})</span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Pick a destination to see your plan price.</p>
                        )}
                        {planFirstRide && (
                          <p className="text-xs text-muted-foreground" data-testid="text-plan-first-ride">
                            First ride: <strong>{format(planFirstRide, "EEE, MMM d 'at' h:mm a")}</strong>. Rides are booked a week ahead and you can cancel any single day free until 2 hours before.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pickup Location */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Pickup Location</label>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-secondary rounded-full" />
              <Input
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                placeholder="Enter pickup address"
                data-testid="input-pickup-address"
              />
            </div>
            <Textarea
              placeholder="Pickup instructions (optional): e.g., Meet me at the main entrance"
              value={pickupInstructions}
              onChange={(e) => setPickupInstructions(e.target.value)}
              rows={2}
              className="text-sm"
              data-testid="textarea-pickup-instructions"
            />
          </div>

          {/* Destination */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Destination</label>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-destructive rounded-full" />
              <AddressAutocomplete
                value={destinationAddress}
                onChange={(v) => { setDestinationAddress(v); setDestCoords(null); }}
                onSelect={handleDestinationSelect}
                placeholder="Where are you going?"
                className="flex-1"
                data-testid="input-destination"
              />
            </div>
          </div>

          {/* Stops on the way ("Add a stop") */}
          <div className="space-y-2" data-testid="stops-block-schedule">
            {stops.map((st, i) => (
              <div key={i} className="flex items-center space-x-2 text-sm">
                <div className="w-3 h-3 bg-amber-400 rounded-full flex-shrink-0" />
                <span className="flex-1 truncate">Stop {i + 1}: {st.address}</span>
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full text-gray-500 text-xl leading-none active:bg-gray-100"
                  aria-label="Remove stop"
                  data-testid={`button-remove-stop-schedule-${i}`}
                >
                  ×
                </button>
              </div>
            ))}
            {addingStop ? (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-amber-400 rounded-full flex-shrink-0" />
                <AddressAutocomplete
                  value={stopDraft}
                  onChange={setStopDraft}
                  onSelect={addStop}
                  placeholder="Add a stop — start typing an address"
                  className="flex-1"
                  data-testid="input-stop-schedule"
                />
                <button type="button" onClick={() => { setAddingStop(false); setStopDraft(""); }} className="text-xs text-muted-foreground px-2 py-2">Cancel</button>
              </div>
            ) : stops.length < MAX_RIDE_STOPS ? (
              <button type="button" onClick={() => setAddingStop(true)} className="text-sm text-primary font-semibold py-1" data-testid="button-add-stop-schedule">
                + Add a stop
              </button>
            ) : null}
          </div>

          {/* Fare Estimate */}
          {fareEstimate && (
            <Card className="bg-muted">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Fare Estimate</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base fare</span>
                    <span>${fareEstimate.baseFare.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time ({estimatedDuration ?? '...'} min)</span>
                    <span>${fareEstimate.timeCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance ({estimatedDistance ?? '...'} mi)</span>
                    <span>${fareEstimate.distanceCharge.toFixed(2)}</span>
                  </div>
                  {fareEstimate.surgeAdjustment !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Surge</span>
                      <span className={fareEstimate.surgeAdjustment < 0 ? "text-green-600" : "text-red-600"}>
                        {fareEstimate.surgeAdjustment < 0 ? "-" : "+"}${Math.abs(fareEstimate.surgeAdjustment).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {(fareEstimate.promoDiscount ?? 0) > 0 && (
                    <div className="flex justify-between text-orange-600 font-semibold">
                      <span>🎉 PG Welcome Credit ({fareEstimate.promoRidesRemaining} left)</span>
                      <span>-${fareEstimate.promoDiscount?.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span data-testid="text-total-fare">
                      ${(fareEstimate.promoDiscount ?? 0) > 0 ? fareEstimate.totalAfterPromo?.toFixed(2) : fareEstimate.total.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {fareEstimate.formula}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Share My Ride toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Share My Ride</p>
                <p className="text-[10px] text-blue-600 dark:text-blue-400">Save 30% if matched with a co-rider</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {wantsSharedRide && fareEstimate && (
                <span className="text-xs font-bold text-green-600 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
                  ~${(fareEstimate.total * 0.7).toFixed(2)} if matched
                </span>
              )}
              <Switch
                checked={wantsSharedRide}
                onCheckedChange={setWantsSharedRide}
                data-testid="switch-shared-ride"
              />
            </div>
          </div>

          {/* Driver Search by Phone */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search Driver by Phone Number
            </label>
            <div className="flex gap-2">
              <Input
                value={phoneSearch}
                onChange={(e) => setPhoneSearch(e.target.value)}
                placeholder="Enter driver's phone number"
                data-testid="input-driver-phone-search"
              />
              <Button 
                onClick={handleSearchDriver} 
                disabled={searchDriverMutation.isPending}
                data-testid="button-search-driver"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
            {searchedDrivers.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchedDrivers([]);
                  setPhoneSearch("");
                  // The searched driver's card disappears with the search —
                  // don't leave it invisibly selected.
                  setSelectedDriver("");
                }}
                className="text-xs"
                data-testid="button-clear-search"
              >
                Clear search and show all drivers
              </Button>
            )}
          </div>

          {/* Available Drivers */}
          <div>
            <h3 className="font-semibold mb-1">
              {searchedDrivers.length > 0
                ? "Search Results"
                : bookingType === "schedule"
                ? "Driver (optional)"
                : "Choose Your Driver"}
            </h3>
            {/* Scheduled rides don't need a driver up front. The explicit
                "open to all" radio (default) also lets a rider UN-pick a
                driver — radio groups otherwise have no way back, which made
                driver selection look mandatory. */}
            {bookingType === "schedule" && (
              <label
                className="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-muted mb-2 border-primary/40 bg-primary/5"
                data-testid="driver-option-open"
              >
                <input
                  type="radio"
                  name="driver"
                  value=""
                  checked={!selectedDriver}
                  onChange={() => setSelectedDriver("")}
                  className="mr-3"
                />
                <div className="flex-1">
                  <span className="font-medium">Open to all drivers</span>
                  <p className="text-xs text-muted-foreground">
                    Your ride goes on the driver board — the first available driver claims it. Recommended.
                  </p>
                </div>
              </label>
            )}
            {availableDrivers.length === 0 ? (
              // Scheduled rides don't need anyone online right now — the
              // "no drivers" empty state only applies to Book Now.
              bookingType !== "schedule" && (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    <p>No drivers available</p>
                  </CardContent>
                </Card>
              )
            ) : (
              <div className="space-y-2">
                {availableDrivers.map((driver) => (
                  <label
                    key={driver.id}
                    className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-muted"
                    data-testid={`driver-option-${driver.id}`}
                  >
                    <input
                      type="radio"
                      name="driver"
                      value={driver.id}
                      checked={selectedDriver === driver.id}
                      onChange={(e) => setSelectedDriver(e.target.value)}
                      className="mr-3"
                    />
                    <img
                      src={driver.profileImage || `https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=50&h=50&fit=crop&crop=face`}
                      alt={`Driver ${driver.name}`}
                      className="w-10 h-10 rounded-full mr-3"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{driver.name}</span>
                        {driver.isVerifiedNeighbor && (
                          <span className="bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded-full">
                            Verified
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1 text-sm">
                        <div className="text-yellow-500">★★★★★</div>
                        <span className="text-muted-foreground">{driver.rating} • {driver.estimatedTime}</span>
                      </div>
                      {driver.phone && (
                        <p className="text-xs text-muted-foreground">{driver.phone}</p>
                      )}
                    </div>
                    <span className="font-semibold">{driver.estimatedFare}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </CardContent>

        <div className="p-4 bg-card border-t space-y-2 shrink-0 sticky bottom-0" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {bookingType === "schedule" && weeklyPlan ? (
            <p className="text-sm text-center text-muted-foreground">
              {describePlanDays(planDays) || "Pick your days"} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}
              {planPricing ? ` · $${planPricing.perRide.toFixed(2)} per ride` : ""}
            </p>
          ) : bookingType === "schedule" && scheduledDate && (
            <p className="text-sm text-center text-muted-foreground">
              Pickup: {format(scheduledDate, "MMM dd")} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}
            </p>
          )}
          {scheduleTimeError && (
            <p className="text-sm text-center text-destructive" data-testid="text-schedule-time-error">
              {scheduleTimeError}
            </p>
          )}
          <Button
            onClick={handleBookRide}
            disabled={
              bookRideMutation.isPending ||
              startPlanMutation.isPending ||
              !destinationAddress ||
              !fareEstimate ||
              (bookingType === "now" && !selectedDriver) ||
              (bookingType === "schedule" && weeklyPlan && planDays.length === 0) ||
              (bookingType === "schedule" && !weeklyPlan && (!scheduledDate || !!scheduleTimeError))
            }
            className="w-full"
            data-testid="button-confirm-booking"
          >
            {bookRideMutation.isPending || startPlanMutation.isPending
              ? "Booking..."
              : bookingType === "schedule" && weeklyPlan
              ? "Start my weekly ride"
              : bookingType === "schedule"
              ? selectedDriver ? "Schedule with Driver" : "Schedule — Open to Drivers"
              : "Book Now"}
          </Button>
        </div>
      </Card>
    </div>
    </SheetPortal>
  );
}
