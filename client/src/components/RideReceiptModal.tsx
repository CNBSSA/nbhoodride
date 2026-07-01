import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Download, X } from "lucide-react";
import type { RideReceipt } from "@shared/rideReceipt";
import { formatReceiptAsText } from "@shared/rideReceipt";
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@shared/vehicleTypes";

interface RideReceiptModalProps {
  rideId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onReportIssue?: () => void;
}

/** Fetches `/api/rides/:id/receipt` and shows itemized PG Ride receipt. */
export function RideReceiptModal({
  rideId,
  isOpen,
  onClose,
  onReportIssue,
}: RideReceiptModalProps) {
  const { data: receipt, isLoading, error } = useQuery<RideReceipt>({
    queryKey: ["/api/rides", rideId, "receipt"],
    queryFn: async () => {
      const res = await fetch(`/api/rides/${rideId}/receipt`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load receipt");
      }
      return res.json();
    },
    enabled: isOpen && !!rideId,
  });

  if (!isOpen || !rideId) return null;

  const handleDownload = () => {
    if (!receipt) return;
    const blob = new Blob([formatReceiptAsText(receipt)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pg-ride-receipt-${receipt.rideId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative w-full mx-4 max-h-[90vh] overflow-y-auto" data-testid="ride-receipt-modal">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold">Trip Receipt</h2>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-receipt">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <CardContent className="p-4 space-y-4">
          {isLoading && (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading receipt…
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive text-center py-8">
              {(error as Error).message}
            </p>
          )}
          {receipt && (
            <>
              <div className="text-center pb-2 border-b">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">PG Ride</p>
                <p className="text-2xl font-bold text-primary mt-1">
                  ${receipt.totalCharged.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{receipt.date}</p>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium">{receipt.driverName}</p>
                <p className="text-muted-foreground truncate">{receipt.pickupAddress}</p>
                <p className="text-muted-foreground truncate">→ {receipt.destinationAddress}</p>
              </div>

              {receipt.bookedForFriend && receipt.passengerName && (
                <p className="text-xs bg-purple-50 text-purple-800 rounded-lg px-3 py-2">
                  Passenger: {receipt.passengerName}
                </p>
              )}
              {receipt.requestedVehicleType && receipt.requestedVehicleType !== "standard" && (
                <p className="text-xs text-muted-foreground">
                  Vehicle: {VEHICLE_TYPE_LABELS[receipt.requestedVehicleType as VehicleType] ?? receipt.requestedVehicleType}
                </p>
              )}

              <Card className="bg-muted/50">
                <CardContent className="p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base fare</span>
                    <span>${receipt.baseFare.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Time ({receipt.durationMinutes ?? 0} min)
                    </span>
                    <span>${receipt.timeCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Distance ({receipt.distanceMiles ?? 0} mi)
                    </span>
                    <span>${receipt.distanceCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>${receipt.subtotal.toFixed(2)}</span>
                  </div>
                  {receipt.promoDiscount > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Promo credit</span>
                      <span>-${receipt.promoDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {receipt.sharedDiscount > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Shared ride savings</span>
                      <span>-${receipt.sharedDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {receipt.tip > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tip</span>
                      <span>${receipt.tip.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total charged</span>
                    <span data-testid="receipt-total">${receipt.totalCharged.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{receipt.paymentMethodLabel}</span>
                    <span>{receipt.paymentStatus}</span>
                  </div>
                </CardContent>
              </Card>

              {(receipt.riderRating || receipt.driverRating) && (
                <p className="text-xs text-muted-foreground text-center">
                  {receipt.riderRating ? `Your rating: ${receipt.riderRating}★` : ""}
                  {receipt.riderRating && receipt.driverRating ? " · " : ""}
                  {receipt.driverRating ? `Driver rated you ${receipt.driverRating}★` : ""}
                </p>
              )}
            </>
          )}
        </CardContent>

        {receipt && (
          <div className="p-4 border-t space-y-2 sticky bottom-0 bg-card">
            <Button className="w-full" onClick={handleDownload} data-testid="button-download-receipt">
              <Download className="w-4 h-4 mr-2" />
              Download Receipt
            </Button>
            {onReportIssue && (
              <Button variant="outline" className="w-full" onClick={onReportIssue} data-testid="button-report-issue-receipt">
                Report Issue
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
