import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { RideReceiptModal } from "@/components/RideReceiptModal";
import ReportModal from "@/components/ReportModal";
import LostFoundModal from "@/components/LostFoundModal";
import { formatPaymentMethodLabel } from "@shared/rideReceipt";

export default function RideHistory() {
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [receiptRideId, setReceiptRideId] = useState<string | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [reportRideId, setReportRideId] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isLostFoundOpen, setIsLostFoundOpen] = useState(false);
  const { user } = useAuth();

  const { data: rides = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/rides", selectedPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/rides?days=${selectedPeriod}&limit=100`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load rides");
      return res.json();
    },
    enabled: !!user,
  });

  const handleViewReceipt = (ride: { id: string; status: string }) => {
    if (ride.status !== "completed") return;
    setReceiptRideId(ride.id);
    setIsReceiptOpen(true);
  };

  const handleReportIssue = (rideId: string) => {
    setReportRideId(rideId);
    setIsReceiptOpen(false);
    setIsReportModalOpen(true);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return "Today";
    if (diffDays === 2) return "Yesterday";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? "text-yellow-500" : "text-muted-foreground"}>
        ★
      </span>
    ));

  const fareDisplay = (ride: any) => {
    const amount = parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0");
    return amount.toFixed(2);
  };

  return (
    <>
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

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            <i className="fas fa-spinner animate-spin text-2xl mb-2" />
            <p>Loading your ride history...</p>
          </div>
        ) : rides.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <i className="fas fa-car text-4xl mb-4" />
              <h3 className="text-lg font-semibold mb-2">No rides in this period</h3>
              <p>Completed rides will appear here with downloadable receipts</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rides.map((ride: any) => (
              <Card key={ride.id} className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate" data-testid={`ride-route-${ride.id}`}>
                        {ride.pickupLocation?.address} → {ride.destinationLocation?.address}
                      </h3>
                      <p className="text-sm text-muted-foreground" data-testid={`ride-details-${ride.id}`}>
                        {formatDate(ride.completedAt || ride.createdAt)} •{" "}
                        {ride.distance ? `${parseFloat(ride.distance).toFixed(1)} mi` : "—"} •{" "}
                        {ride.duration ?? "—"} min
                      </p>
                      <div className="flex items-center space-x-2 mt-2">
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs">
                          <i className="fas fa-user" />
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {ride.driver
                            ? `${ride.driver.firstName} ${ride.driver.lastName?.[0] || ""}.`
                            : ride.driverId
                              ? "Driver"
                              : "No driver"}
                        </span>
                        {ride.driverRating && (
                          <div className="flex text-xs">{renderStars(ride.driverRating)}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-2 shrink-0">
                      <p className="text-lg font-bold" data-testid={`ride-fare-${ride.id}`}>
                        ${fareDisplay(ride)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPaymentMethodLabel(ride.paymentMethod)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex flex-wrap gap-2">
                      {ride.status === "completed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewReceipt(ride)}
                          className="text-primary"
                          data-testid={`button-view-receipt-${ride.id}`}
                        >
                          View Receipt
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReportIssue(ride.id)}
                        className="text-muted-foreground"
                        data-testid={`button-report-issue-${ride.id}`}
                      >
                        Report Issue
                      </Button>
                      {ride.status === "completed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReportRideId(ride.id);
                            setIsLostFoundOpen(true);
                          }}
                          className="text-muted-foreground"
                          data-testid={`button-lost-item-${ride.id}`}
                        >
                          Lost Item
                        </Button>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(ride.status)}`}>
                      {ride.status === "completed"
                        ? "Completed"
                        : ride.status === "cancelled"
                          ? "Cancelled"
                          : ride.status === "in_progress"
                            ? "In Progress"
                            : "Pending"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <RideReceiptModal
        rideId={receiptRideId}
        isOpen={isReceiptOpen}
        onClose={() => {
          setIsReceiptOpen(false);
          setReceiptRideId(null);
        }}
        onReportIssue={
          receiptRideId ? () => handleReportIssue(receiptRideId) : undefined
        }
      />

      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        rideId={reportRideId}
      />
      <LostFoundModal
        isOpen={isLostFoundOpen}
        onClose={() => setIsLostFoundOpen(false)}
        rideId={reportRideId}
      />
    </>
  );
}
