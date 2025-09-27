import { useQuery } from '@tanstack/react-query';
import { PaymentConfirmationCard } from '@/components/PaymentConfirmationCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign } from 'lucide-react';
import type { Ride } from '@shared/schema';

type RideWithRider = Ride & {
  rider: {
    id: string;
    firstName: string;
    lastName: string;
    rating: string;
    profileImageUrl?: string;
  };
};

export function PaymentsPage() {
  const { data: ridesAwaitingPayment, isLoading } = useQuery<RideWithRider[]>({
    queryKey: ['/api/rides/awaiting-payment'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Payment Confirmations</h1>
          <p className="text-muted-foreground">
            Confirm cash payments from completed rides
          </p>
        </div>
        
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="w-full">
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!ridesAwaitingPayment || ridesAwaitingPayment.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Payment Confirmations</h1>
          <p className="text-muted-foreground">
            Confirm cash payments from completed rides
          </p>
        </div>
        
        <Card className="text-center py-12">
          <CardContent>
            <DollarSign className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <CardTitle className="text-xl mb-2" data-testid="no-payments-title">
              No Payments Pending
            </CardTitle>
            <CardDescription data-testid="no-payments-description">
              All your ride payments have been confirmed. 
              New rides will appear here when they need payment confirmation.
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Payment Confirmations</h1>
        <p className="text-muted-foreground">
          Confirm cash payments from {ridesAwaitingPayment.length} completed ride{ridesAwaitingPayment.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-6" data-testid="payments-list">
        {ridesAwaitingPayment.map((ride) => (
          <PaymentConfirmationCard
            key={ride.id}
            ride={ride}
          />
        ))}
      </div>
    </div>
  );
}