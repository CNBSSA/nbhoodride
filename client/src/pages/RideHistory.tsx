import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import RideDetailsModal from "@/components/RideDetailsModal";
import ReportModal from "@/components/ReportModal";

export default function RideHistory() {
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [selectedRide, setSelectedRide] = useState<any>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const { user } = useAuth();

  // Fetch ride history
  const { data: rides = [], isLoading } = useQuery({
    queryKey: ["/api/rides"],
    enabled: !!user,
  });

  const handleViewDetails = (ride: any) => {
    setSelectedRide(ride);
    setIsDetailsModalOpen(true);
  };

  const handleReportIssue = (ride?: any) => {
    if (ride) {
      setSelectedRide(ride);
    }
    setIsDetailsModalOpen(false);
    setIsReportModalOpen(true);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return "Today";
    if (diffDays === 2) return "Yesterday";
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-secondary bg-secondary/10";
      case "cancelled":
        return "text-destructive bg-destructive/10";
      case "in_progress":
        return "text-primary bg-primary/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? "text-yellow-500" : "text-muted-foreground"}>
        ★
      </span>
    ));
  };

  return (
    <>
      {/* Header */}
      <header className="bg-card border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <i className="fas fa-history text-primary text-2xl" />
          <div>
            <h1 className="text-lg font-bold">Ride History</h1>
            <p className="text-xs text-muted-foreground">Your past trips</p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {/* Period Filter */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Rides</h2>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 3 months</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Rides List */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            <i className="fas fa-spinner animate-spin text-2xl mb-2" />
            <p>Loading your ride history...</p>
          </div>
        ) : rides.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <i className="fas fa-car text-4xl mb-4" />
              <h3 className="text-lg font-semibold mb-2">No rides yet</h3>
              <p>Your completed rides will appear here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rides.map((ride: any) => (
              <Card key={ride.id} className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-semibold" data-testid={`ride-route-${ride.id}`}>
                          {ride.pickupLocation?.address} → {ride.destinationLocation?.address}
                        </h3>
                      </div>
                      <p className="text-sm text-muted-foreground" data-testid={`ride-details-${ride.id}`}>
                        {formatDate(ride.completedAt || ride.createdAt)} • {ride.distance || 0} miles • {ride.duration || 0} min
                      </p>
                      <div className="flex items-center space-x-2 mt-2">
                        <img
                          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=24&h=24&fit=crop&crop=face"
                          alt="Driver"
                          className="w-6 h-6 rounded-full"
                        />
                        <span className="text-sm text-muted-foreground">
                          Driver {ride.driverId ? "Marcus T." : "N/A"}
                        </span>
                        {ride.driverRating && (
                          <div className="flex text-xs">
                            {renderStars(ride.driverRating)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold" data-testid={`ride-fare-${ride.id}`}>
                        ${ride.actualFare || ride.estimatedFare || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Cash</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetails(ride)}
                        className="text-primary"
                        data-testid={`button-view-receipt-${ride.id}`}
                      >
                        View Receipt
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReportIssue(ride)}
                        className="text-muted-foreground"
                        data-testid={`button-report-issue-${ride.id}`}
                      >
                        Report Issue
                      </Button>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(ride.status)}`}>
                      {ride.status === "completed" ? "Completed" : 
                       ride.status === "cancelled" ? "Cancelled" :
                       ride.status === "in_progress" ? "In Progress" : "Pending"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      <RideDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onReportIssue={() => handleReportIssue()}
        ride={selectedRide}
      />

      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        rideId={selectedRide?.id || null}
      />
    </>
  );
}
