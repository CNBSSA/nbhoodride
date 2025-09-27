import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, DollarSign, User } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Ride } from '@shared/schema';

interface PaymentConfirmationCardProps {
  ride: Ride & {
    rider: {
      id: string;
      firstName: string;
      lastName: string;
      rating: string;
      profileImageUrl?: string;
    };
  };
}

export function PaymentConfirmationCard({ ride }: PaymentConfirmationCardProps) {
  const [tipAmount, setTipAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const confirmPaymentMutation = useMutation({
    mutationFn: async (data: { tipAmount?: number }) => {
      return await apiRequest(`/api/rides/${ride.id}/confirm-payment`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onMutate: () => {
      setIsSubmitting(true);
    },
    onSuccess: () => {
      toast({
        title: "Payment Confirmed!",
        description: "Cash payment has been successfully recorded.",
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/rides/awaiting-payment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/earnings"] });
    },
    onError: (error: any) => {
      let title = "Failed to Confirm Payment";
      let description = "Unable to confirm payment. Please try again.";
      
      if (error?.message?.includes("already been confirmed")) {
        title = "Already Confirmed";
        description = "This payment has already been confirmed.";
      } else if (error?.message?.includes("Only the driver")) {
        title = "Unauthorized";
        description = "Only the driver can confirm payment.";
      }
      
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    }
  });

  const handleConfirmPayment = () => {
    const tipValue = tipAmount ? parseFloat(tipAmount) : undefined;
    if (tipAmount && (isNaN(tipValue) || tipValue < 0)) {
      toast({
        title: "Invalid Tip Amount",
        description: "Please enter a valid tip amount.",
        variant: "destructive",
      });
      return;
    }
    
    confirmPaymentMutation.mutate({ tipAmount: tipValue });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Confirm Cash Payment</span>
          <Badge variant="secondary" data-testid={`badge-status-${ride.id}`}>
            Payment Pending
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rider Information */}
        <div className="flex items-center space-x-3" data-testid={`rider-info-${ride.id}`}>
          <div className="flex-shrink-0">
            <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="font-medium text-sm">
              {ride.rider.firstName} {ride.rider.lastName}
            </p>
            <p className="text-xs text-muted-foreground">
              ⭐ {parseFloat(ride.rider.rating).toFixed(1)}
            </p>
          </div>
        </div>

        <Separator />

        {/* Trip Details */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-sm">
            <MapPin className="w-4 h-4 text-green-500" />
            <span className="truncate" data-testid={`pickup-${ride.id}`}>
              {ride.pickupLocation.address}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-sm">
            <MapPin className="w-4 h-4 text-red-500" />
            <span className="truncate" data-testid={`destination-${ride.id}`}>
              {ride.destinationLocation.address}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-sm">
            <Clock className="w-4 h-4 text-blue-500" />
            <span data-testid={`completed-time-${ride.id}`}>
              Completed: {new Date(ride.completedAt!).toLocaleString()}
            </span>
          </div>
        </div>

        <Separator />

        {/* Fare Information */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Ride Fare:</span>
            <span className="font-medium" data-testid={`fare-${ride.id}`}>
              ${parseFloat(ride.actualFare || ride.estimatedFare || '0').toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Current Tip:</span>
            <span className="font-medium" data-testid={`current-tip-${ride.id}`}>
              ${parseFloat(ride.tipAmount || '0').toFixed(2)}
            </span>
          </div>
        </div>

        <Separator />

        {/* Tip Input */}
        <div className="space-y-2">
          <Label htmlFor={`tip-${ride.id}`} className="text-sm">
            Additional Tip (Optional)
          </Label>
          <div className="flex items-center space-x-2">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <Input
              id={`tip-${ride.id}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              disabled={isSubmitting}
              data-testid={`input-tip-${ride.id}`}
            />
          </div>
        </div>

        {/* Total Amount */}
        <div className="bg-muted p-3 rounded-md">
          <div className="flex justify-between font-medium">
            <span>Total Amount:</span>
            <span className="text-lg" data-testid={`total-amount-${ride.id}`}>
              ${(
                parseFloat(ride.actualFare || ride.estimatedFare || '0') + 
                parseFloat(ride.tipAmount || '0') + 
                (tipAmount ? parseFloat(tipAmount) : 0)
              ).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Confirm Button */}
        <Button
          onClick={handleConfirmPayment}
          disabled={isSubmitting}
          className="w-full"
          data-testid={`button-confirm-payment-${ride.id}`}
        >
          {isSubmitting ? "Confirming..." : "Confirm Cash Received"}
        </Button>
      </CardContent>
    </Card>
  );
}