import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface Ride {
  id: string;
  pickupLocation: { address: string };
  destinationLocation: { address: string };
  distance: number;
  duration: number;
  actualFare: number;
  tipAmount: number;
  driverRating: number;
  driverReview: string;
  completedAt: string;
  driver?: {
    name: string;
    profileImage?: string;
    vehicle: string;
    rating: number;
  };
}

interface RideDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReportIssue: () => void;
  ride: Ride | null;
}

export default function RideDetailsModal({
  isOpen,
  onClose,
  onReportIssue,
  ride
}: RideDetailsModalProps) {
  if (!isOpen || !ride) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? "text-yellow-500" : "text-muted-foreground"}>
        ★
      </span>
    ));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <Card className="w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Ride Receipt</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-close-ride-details"
          >
            <i className="fas fa-times" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-6">
          {/* Route Map Placeholder */}
          <Card className="bg-muted">
            <CardContent className="p-4 h-48 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <i className="fas fa-route text-3xl mb-2" />
                <p className="text-sm">Route Map</p>
                <p className="text-xs">
                  {ride.pickupLocation.address} → {ride.destinationLocation.address}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Trip Details */}
          <div>
            <h3 className="font-semibold mb-2">Trip Information</h3>
            <Card className="bg-muted">
              <CardContent className="p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span data-testid="text-trip-date">{formatDate(ride.completedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance</span>
                  <span data-testid="text-trip-distance">{ride.distance} miles</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span data-testid="text-trip-duration">{ride.duration} minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method</span>
                  <span>Cash</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Driver Information */}
          {ride.driver && (
            <div>
              <h3 className="font-semibold mb-2">Driver</h3>
              <Card className="bg-muted">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <img
                      src={ride.driver.profileImage || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&h=60&fit=crop&crop=face"}
                      alt={`Driver ${ride.driver.name}`}
                      className="w-12 h-12 rounded-full"
                    />
                    <div className="flex-1">
                      <p className="font-medium" data-testid="text-driver-name">
                        {ride.driver.name}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid="text-driver-vehicle">
                        {ride.driver.vehicle}
                      </p>
                      <div className="flex items-center space-x-1 mt-1">
                        <div className="flex">
                          {renderStars(ride.driver.rating)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {ride.driver.rating} rating
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Fare Breakdown */}
          <div>
            <h3 className="font-semibold mb-2">Fare Breakdown</h3>
            <Card className="bg-muted">
              <CardContent className="p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base Fare ({ride.duration} min)</span>
                  <span>${((ride.duration / 60) * 18).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance ({ride.distance} miles × $1.50)</span>
                  <span>${(ride.distance * 1.50).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Driver Discount</span>
                  <span className="text-secondary">-$0.00</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total Paid</span>
                  <span data-testid="text-total-paid">${ride.actualFare}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tip (Cash)</span>
                  <span className="text-secondary" data-testid="text-tip-amount">
                    ${ride.tipAmount}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rating */}
          {ride.driverRating && (
            <div>
              <h3 className="font-semibold mb-2">Your Rating</h3>
              <Card className="bg-muted">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="flex text-lg">
                      {renderStars(ride.driverRating)}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {ride.driverRating} stars
                    </span>
                  </div>
                  {ride.driverReview && (
                    <p className="text-sm text-muted-foreground italic">
                      "{ride.driverReview}"
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>

        <div className="p-4 border-t space-y-2">
          <Button className="w-full" data-testid="button-download-receipt">
            <i className="fas fa-download mr-2" />
            Download Receipt
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={onReportIssue}
            data-testid="button-report-issue"
          >
            <i className="fas fa-flag mr-2" />
            Report Issue with this Ride
          </Button>
        </div>
      </Card>
    </div>
  );
}
