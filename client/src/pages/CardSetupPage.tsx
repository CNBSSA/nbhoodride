import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, CheckCircle, AlertCircle } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

function CardSetupForm() {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const setupCardMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const response = await apiRequest('/api/payment/setup-card', {
        method: 'POST',
        body: JSON.stringify({ paymentMethodId }),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Card Added Successfully!",
        description: "Your payment method has been saved securely.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/payment/methods'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Card",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);

    if (!cardElement) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (error) {
        toast({
          title: "Card Validation Failed",
          description: error.message,
          variant: "destructive",
        });
      } else if (paymentMethod) {
        await setupCardMutation.mutateAsync(paymentMethod.id);
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Card Information</label>
          <div className="p-3 border rounded-md bg-background">
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: 'hsl(var(--foreground))',
                    '::placeholder': {
                      color: 'hsl(var(--muted-foreground))',
                    },
                  },
                  invalid: {
                    color: 'hsl(var(--destructive))',
                  },
                },
              }}
            />
          </div>
        </div>

        <Button 
          type="submit" 
          className="w-full"
          disabled={!stripe || isProcessing}
          data-testid="button-save-card"
        >
          {isProcessing ? 'Processing...' : 'Save Card'}
        </Button>
      </div>
    </form>
  );
}

export function CardSetupPage() {
  const { data: paymentMethods, isLoading } = useQuery({
    queryKey: ['/api/payment/methods'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Payment Methods</h1>
          <p className="text-muted-foreground">
            Manage your payment methods for rides
          </p>
        </div>
        
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" data-testid="text-page-title">Payment Methods</h1>
        <p className="text-muted-foreground">
          Manage your payment methods for rides
        </p>
      </div>

      <div className="space-y-6">
        {paymentMethods?.hasPaymentMethod && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Card on File
              </CardTitle>
              <CardDescription>
                You have a payment method saved
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <CreditCard className="w-8 h-8 text-muted-foreground" />
                <div>
                  <p className="font-medium" data-testid="text-card-status">Payment method saved</p>
                  <p className="text-sm text-muted-foreground">
                    Your card will be charged after each completed ride
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {paymentMethods?.hasPaymentMethod ? 'Update Payment Method' : 'Add Payment Method'}
            </CardTitle>
            <CardDescription>
              Add a credit or debit card to pay for rides
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Elements stripe={stripePromise}>
              <CardSetupForm />
            </Elements>
          </CardContent>
        </Card>

        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  How Card Payments Work
                </p>
                <ul className="space-y-1 text-amber-800 dark:text-amber-200">
                  <li>• When a driver accepts your ride, we authorize the estimated fare</li>
                  <li>• After the ride completes, we charge the actual fare plus any tip</li>
                  <li>• If you cancel after the driver starts traveling, a cancellation fee may apply:
                    <ul className="ml-4 mt-1 space-y-0.5">
                      <li>- $3.50 if driver traveled ≥1.5mi AND ≥3min</li>
                      <li>- $5.00 if driver traveled ≥3mi AND ≥5min</li>
                    </ul>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
