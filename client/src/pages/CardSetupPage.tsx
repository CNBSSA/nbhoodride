import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, CheckCircle, AlertCircle, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useStripeConfig } from '@/hooks/useStripeConfig';
import {
  formatCardBrandLabel,
  formatCardExpiry,
  formatMaskedCardLine,
  type SavedCardSummary,
} from '@shared/paymentMethodDisplay';

/** Header with a back link to Profile — this route is reached from Profile's
 *  "Payment Methods" button but lives outside the tab-shell (Home.tsx), so
 *  without this there was no way back except an OS/browser back gesture,
 *  which doesn't exist in the Capacitor app shell. Riders got stuck here. */
function CardSetupHeader() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <Link href="/">
        <button className="p-1 -ml-1" data-testid="button-back-card-setup" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </Link>
      <h1 className="text-2xl font-bold" data-testid="text-page-title">Payment Methods</h1>
    </div>
  );
}

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY as string | undefined;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

interface PaymentMethodsResponse {
  hasPaymentMethod: boolean;
  methods: SavedCardSummary[];
  defaultPaymentMethodId: string | null;
}

function SavedCardCarousel({
  methods,
  selectedIndex,
  onSelectIndex,
}: {
  methods: SavedCardSummary[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const card = methods[selectedIndex];
  if (!card) return null;

  const goPrev = () => onSelectIndex((selectedIndex - 1 + methods.length) % methods.length);
  const goNext = () => onSelectIndex((selectedIndex + 1) % methods.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={goPrev}
          disabled={methods.length <= 1}
          aria-label="Previous card"
          data-testid="button-prev-card"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground tabular-nums">
          Card {selectedIndex + 1} of {methods.length}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={goNext}
          disabled={methods.length <= 1}
          aria-label="Next card"
          data-testid="button-next-card"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="rounded-lg border bg-muted/30 p-4"
        data-testid="saved-card-panel"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CreditCard className="w-8 h-8 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium" data-testid="text-card-brand">
                {formatCardBrandLabel(card.brand)}
              </p>
              {card.isDefault && (
                <Badge variant="secondary" data-testid="badge-default-card">
                  Default
                </Badge>
              )}
            </div>
            <p className="font-mono text-lg tracking-wider mt-1" data-testid="text-card-masked">
              {formatMaskedCardLine(card.last4)}
            </p>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-card-expiry">
              Expires {formatCardExpiry(card.expMonth, card.expYear)}
            </p>
          </div>
        </div>
      </div>

      {methods.length > 1 && (
        <div className="flex justify-center gap-1.5" role="tablist" aria-label="Saved cards">
          {methods.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={i === selectedIndex}
              aria-label={`Show card ending in ${m.last4}`}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === selectedIndex ? "bg-primary" : "bg-muted-foreground/40"
              }`}
              onClick={() => onSelectIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardSetupForm() {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const setupCardMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const response = await apiRequest('POST', '/api/payment/setup-card', { paymentMethodId });
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
        cardElement.clear();
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
          <p className="text-xs text-muted-foreground mt-2">
            Full card numbers are never stored or shown after you save — only the last four digits.
          </p>
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
  const { toast } = useToast();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: paymentMethods, isLoading } = useQuery<PaymentMethodsResponse>({
    queryKey: ['/api/payment/methods'],
  });
  const { data: stripeConfig } = useStripeConfig();
  const stripeReady = stripeConfig?.cardOnFileEnabled ?? !!stripePublishableKey;

  const methods = paymentMethods?.methods ?? [];
  const safeIndex = methods.length > 0 ? Math.min(selectedIndex, methods.length - 1) : 0;
  const selectedCard = methods[safeIndex];

  const setDefaultMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const response = await apiRequest('POST', '/api/payment/methods/default', { paymentMethodId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to update card');
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Default card updated' });
      queryClient.invalidateQueries({ queryKey: ['/api/payment/methods'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update default card',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <CardSetupHeader />
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
      <CardSetupHeader />
      <div className="-mt-4 mb-6">
        <p className="text-muted-foreground">
          Manage your payment methods for rides
        </p>
      </div>

      <div className="space-y-6">
        {methods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Saved cards
              </CardTitle>
              <CardDescription>
                Swipe between cards — only the last four digits are shown
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SavedCardCarousel
                methods={methods}
                selectedIndex={safeIndex}
                onSelectIndex={setSelectedIndex}
              />
              {selectedCard && !selectedCard.isDefault && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={setDefaultMutation.isPending}
                  data-testid="button-set-default-card"
                  onClick={() => setDefaultMutation.mutate(selectedCard.id)}
                >
                  Use this card for rides
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {paymentMethods?.hasPaymentMethod && methods.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Card on file
              </CardTitle>
              <CardDescription>
                You have a payment method saved
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground" data-testid="text-card-status">
                Your card is on file. Add a new card below to refresh card details in this list.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {paymentMethods?.hasPaymentMethod ? 'Add another card' : 'Add Payment Method'}
            </CardTitle>
            <CardDescription>
              Add a credit or debit card to pay for rides
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!stripeReady ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900 p-4 text-sm text-amber-900 dark:text-amber-100">
                Card payments are being activated. You can still ride using your Virtual PG Card balance.
              </div>
            ) : stripePromise ? (
              <Elements stripe={stripePromise}>
                <CardSetupForm />
              </Elements>
            ) : null}
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
