import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { RideRatingCard } from '@/components/RideRatingCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Star } from 'lucide-react';
import { useLocation } from 'wouter';

export default function RatingsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Get rides that need rating
  const { data: ridesToRate = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/rides/for-rating"],
    enabled: !!user?.id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/')}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Rate Your Rides</h1>
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                    <div className="h-10 bg-muted rounded"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="text-primary-foreground hover:bg-primary-foreground/10"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center space-x-2">
            <Star className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Rate Your Rides</h1>
          </div>
        </div>
      </header>

      <main className="p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {ridesToRate.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Star className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">All Caught Up!</h2>
                <p className="text-muted-foreground mb-4">
                  You don't have any rides that need rating at the moment.
                </p>
                <p className="text-sm text-muted-foreground">
                  After completing rides, you'll be able to rate your experience here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold">
                  {ridesToRate.length} Ride{ridesToRate.length !== 1 ? 's' : ''} to Rate
                </h2>
                <p className="text-muted-foreground">
                  Your feedback helps build trust in our community
                </p>
              </div>

              <div className="space-y-4" data-testid="rides-for-rating-list">
                {ridesToRate.map((ride: any) => (
                  <RideRatingCard
                    key={ride.id}
                    ride={ride}
                    currentUserId={user?.id || ''}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}