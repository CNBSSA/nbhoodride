import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PG_CARD } from "@shared/userFacingCopy";
import { useFeatureFlags } from "@/hooks/useStripeConfig";

interface WelcomeRiderSheetProps {
  open: boolean;
  balance: string;
  promoRidesRemaining: number;
  onDismiss: () => void;
  onBook: () => void;
}

/** First login after approval — wallet intro + primary CTA (Wave A.5). */
export function WelcomeRiderSheet({
  open,
  balance,
  promoRidesRemaining,
  onDismiss,
  onBook,
}: WelcomeRiderSheetProps) {
  const { walletEnabled } = useFeatureFlags();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onDismiss} aria-hidden />
      <Card className="relative z-10 w-full rounded-t-2xl border-b-0" data-testid="welcome-rider-sheet">
        <CardContent className="pt-6 pb-8 space-y-4">
          <h2 className="text-xl font-bold text-center">Welcome to PG Ride</h2>
          <p className="text-sm text-muted-foreground text-center">
            On-demand rides in Prince George's County, Maryland — book a background-checked local driver in a tap.
          </p>
          {walletEnabled ? (
            <div className="bg-green-50 dark:bg-green-950/40 rounded-lg p-4 text-center">
              <p className="text-xs text-green-800 dark:text-green-300 font-medium">{PG_CARD.fullLabel}</p>
              <p className="text-3xl font-bold text-green-900 dark:text-green-100">${parseFloat(balance || "0").toFixed(2)}</p>
              {promoRidesRemaining > 0 && (
                <p className="text-xs text-orange-600 mt-1">
                  Plus {promoRidesRemaining} welcome ride{promoRidesRemaining > 1 ? "s" : ""} with $5 off
                </p>
              )}
            </div>
          ) : (
            promoRidesRemaining > 0 && (
              <div className="bg-green-50 dark:bg-green-950/40 rounded-lg p-4 text-center">
                <p className="text-xs text-green-800 dark:text-green-300 font-medium">Welcome offer</p>
                <p className="text-lg font-bold text-green-900 dark:text-green-100">
                  {promoRidesRemaining} ride{promoRidesRemaining > 1 ? "s" : ""} with $5 off
                </p>
              </div>
            )
          )}
          <p className="text-sm text-muted-foreground">
            Rides are {walletEnabled ? PG_CARD.confirmLine.toLowerCase() : "charged to your card when you confirm"}. Tap below to book your first trip.
          </p>
          <Button className="w-full" onClick={onBook} data-testid="welcome-book-ride">
            Book a ride
          </Button>
          <Button variant="ghost" className="w-full" onClick={onDismiss} data-testid="welcome-dismiss">
            Maybe later
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
