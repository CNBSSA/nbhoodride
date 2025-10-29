import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, Clock, Search, X } from "lucide-react";
import { format, addDays } from "date-fns";

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
  timeCharge: number;
  distanceCharge: number;
  subtotal: number;
  discount: number;
  total: number;
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
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Search driver by phone number
  const searchDriverMutation = useMutation({
    mutationFn: async (phone: string) => {
      return await apiRequest(`/api/drivers/search?phone=${encodeURIComponent(phone)}`);
    },
    onSuccess: (data) => {
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
    mutationFn: async ({ distance, duration }: { distance: number; duration: number }) => {
      return await apiRequest('/api/rides/calculate-fare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distance, duration })
      });
    },
    onSuccess: (data) => {
      setFareEstimate(data);
    }
  });

  // Book ride mutation
  const bookRideMutation = useMutation({
    mutationFn: async (rideData: any) => {
      return await apiRequest('/api/rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rideData)
      });
    },
    onSuccess: (data) => {
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
    onError: () => {
      toast({
        title: "Booking Failed",
        description: "Unable to book your ride. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Mock fare calculation for demo (replace with actual geocoding)
  useEffect(() => {
    if (destinationAddress.length > 3) {
      const mockDistance = 8.2;
      const mockDuration = 18;
      calculateFareMutation.mutate({ distance: mockDistance, duration: mockDuration });
    }
  }, [destinationAddress]);

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
    if (!destinationAddress || !selectedDriver) {
      toast({
        title: "Missing Information",
        description: "Please select a destination and driver.",
        variant: "destructive",
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
        lat: userLocation.lat + 0.01,
        lng: userLocation.lng + 0.01,
        address: destinationAddress
      },
      pickupInstructions,
      driverId: selectedDriver,
      estimatedFare: fareEstimate?.total || 0,
      scheduledAt
    };

    bookRideMutation.mutate(rideData);
  };

  const availableDrivers = searchedDrivers.length > 0 ? searchedDrivers : drivers;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 w-full h-[90vh] rounded-t-xl border-0 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Schedule a Ride</h2>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-schedule">
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-4 overflow-y-auto h-full pb-32">
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
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    Select Date
                  </label>
                  <Calendar
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    disabled={(date) => date < new Date() || date > addDays(new Date(), 30)}
                    className="rounded-md border"
                    data-testid="calendar-schedule-date"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Select Time
                  </label>
                  <div className="flex gap-2">
                    <Select value={scheduledHour} onValueChange={setScheduledHour}>
                      <SelectTrigger className="w-20" data-testid="select-hour">
                        <SelectValue placeholder="Hour" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => {
                          const hour = (i + 1).toString().padStart(2, '0');
                          return <SelectItem key={hour} value={hour}>{hour}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                    <span className="flex items-center">:</span>
                    <Select value={scheduledMinute} onValueChange={setScheduledMinute}>
                      <SelectTrigger className="w-20" data-testid="select-minute">
                        <SelectValue placeholder="Min" />
                      </SelectTrigger>
                      <SelectContent>
                        {["00", "15", "30", "45"].map((min) => (
                          <SelectItem key={min} value={min}>{min}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scheduledPeriod} onValueChange={(v) => setScheduledPeriod(v as "AM" | "PM")}>
                      <SelectTrigger className="w-20" data-testid="select-period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AM">AM</SelectItem>
                        <SelectItem value="PM">PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scheduledDate && (
                    <p className="text-sm text-muted-foreground">
                      Pickup scheduled for: <strong>{format(scheduledDate, "MMM dd, yyyy")} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}</strong>
                    </p>
                  )}
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
              <Input
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Where are you going?"
                data-testid="input-destination"
              />
            </div>
          </div>

          {/* Fare Estimate */}
          {fareEstimate && (
            <Card className="bg-muted">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Fare Estimate</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance: 8.2 miles</span>
                    <span>${fareEstimate.distanceCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time: 18 minutes</span>
                    <span>${fareEstimate.timeCharge.toFixed(2)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total (Virtual Card)</span>
                    <span data-testid="text-total-fare">${fareEstimate.total.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {fareEstimate.formula}
                </p>
              </CardContent>
            </Card>
          )}

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
            <h3 className="font-semibold mb-3">
              {searchedDrivers.length > 0 ? "Search Results" : "Choose Your Driver"}
            </h3>
            {availableDrivers.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  <p>No drivers available</p>
                </CardContent>
              </Card>
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

        <div className="absolute bottom-0 left-0 right-0 p-4 bg-card border-t space-y-2">
          {bookingType === "schedule" && scheduledDate && (
            <p className="text-sm text-center text-muted-foreground">
              Pickup: {format(scheduledDate, "MMM dd")} at {scheduledHour}:{scheduledMinute} {scheduledPeriod}
            </p>
          )}
          <Button
            onClick={handleBookRide}
            disabled={bookRideMutation.isPending || !selectedDriver || !destinationAddress || !fareEstimate || (bookingType === "schedule" && !scheduledDate)}
            className="w-full"
            data-testid="button-confirm-booking"
          >
            {bookRideMutation.isPending ? "Booking..." : bookingType === "schedule" ? "Schedule Ride" : "Book Now"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
