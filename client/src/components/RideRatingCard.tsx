import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { MapPin, Star, User } from 'lucide-react';

interface RideRatingCardProps {
  ride: {
    id: string;
    riderId: string;
    driverId: string;
    pickupLocation: {
      address: string;
    };
    destinationLocation: {
      address: string;
    };
    actualFare?: string;
    completedAt: string;
    rider?: {
      firstName: string;
      lastName: string;
      rating: string;
    };
    driver?: {
      firstName: string;
      lastName: string;
      rating: string;
    };
  };
  currentUserId: string;
}

export function RideRatingCard({ ride, currentUserId }: RideRatingCardProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [review, setReview] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Determine if current user is rider or driver
  const isRider = ride.riderId === currentUserId;
  const otherPerson = isRider ? ride.driver : ride.rider;
  const role = isRider ? 'driver' : 'rider';

  const submitRatingMutation = useMutation({
    mutationFn: async (data: { rating: number; review?: string }) => {
      const response = await apiRequest('POST', `/api/rides/${ride.id}/rating`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides/for-rating"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Rating Submitted!",
        description: `Thank you for rating your ${role}.`,
      });
    },
    onError: (error: any) => {
      let title = "Failed to Submit Rating";
      let description = "Unable to submit your rating. Please try again.";
      
      if (error?.message?.includes("409")) {
        title = "Already Rated";
        description = "You have already rated this ride.";
        // Invalidate cache to refresh the list
        queryClient.invalidateQueries({ queryKey: ["/api/rides/for-rating"] });
      } else if (error?.message?.includes("403")) {
        title = "Unauthorized";
        description = "You are not authorized to rate this ride.";
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

  const handleSubmitRating = () => {
    if (rating === 0) {
      toast({
        title: "Rating Required",
        description: "Please select a star rating before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    submitRatingMutation.mutate({
      rating,
      review: review.trim() || undefined
    });
  };

  const renderStars = () => {
    return [...Array(5)].map((_, index) => {
      const starValue = index + 1;
      return (
        <button
          key={index}
          type="button"
          onClick={() => setRating(starValue)}
          onMouseEnter={() => setHoveredRating(starValue)}
          onMouseLeave={() => setHoveredRating(0)}
          className="p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-primary rounded"
          data-testid={`star-${starValue}-${ride.id}`}
        >
          <Star
            className={`w-8 h-8 ${
              starValue <= (hoveredRating || rating)
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-300'
            }`}
          />
        </button>
      );
    });
  };

  return (
    <Card className="border-l-4 border-l-primary" data-testid={`card-rating-${ride.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Rate Your {role}</CardTitle>
          <Badge variant="outline" className="text-green-600">
            Completed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trip Details */}
        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <MapPin className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium text-green-600">Pickup</p>
              <p className="text-sm text-muted-foreground" data-testid={`text-pickup-${ride.id}`}>
                {ride.pickupLocation?.address}
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <MapPin className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-600">Destination</p>
              <p className="text-sm text-muted-foreground" data-testid={`text-destination-${ride.id}`}>
                {ride.destinationLocation?.address}
              </p>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Completed: {new Date(ride.completedAt).toLocaleString()}
          </div>

          {ride.actualFare && (
            <div className="text-sm">
              <span className="font-medium">Final Fare: </span>
              <span data-testid={`text-fare-${ride.id}`}>
                ${parseFloat(ride.actualFare).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Person to Rate */}
        {otherPerson && (
          <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg">
            <User className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium" data-testid={`text-other-person-${ride.id}`}>
                {otherPerson.firstName} {otherPerson.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                Current Rating: {parseFloat(otherPerson.rating || "5.0").toFixed(1)} ⭐
              </p>
            </div>
          </div>
        )}

        {/* Rating Input */}
        <div className="space-y-3">
          <div>
            <p className="font-medium mb-2">How was your {role}?</p>
            <div className="flex space-x-1" data-testid={`rating-stars-${ride.id}`}>
              {renderStars()}
            </div>
            {rating > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {rating === 1 && "Poor"}
                {rating === 2 && "Fair"}
                {rating === 3 && "Good"}
                {rating === 4 && "Very Good"}
                {rating === 5 && "Excellent"}
              </p>
            )}
          </div>

          <div>
            <p className="font-medium mb-2">Review (Optional)</p>
            <Textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder={`Share your experience with ${otherPerson?.firstName || 'your ' + role}...`}
              className="min-h-[80px]"
              maxLength={500}
              data-testid={`textarea-review-${ride.id}`}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {review.length}/500 characters
            </p>
          </div>

          <Button
            onClick={handleSubmitRating}
            disabled={isSubmitting || rating === 0}
            className="w-full"
            data-testid={`button-submit-rating-${ride.id}`}
          >
            {isSubmitting ? "Submitting..." : "Submit Rating"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}