import { useLocation } from "wouter";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useStripeConfig } from "@/hooks/useStripeConfig";

/**
 * "Add a payment card" prompt shown inside the booking flows when the rider
 * has no card on file. In card-only mode the server refuses to create a ride
 * without one — surfacing it here (with a one-tap path to the card form) beats
 * letting the rider fill out a whole booking and hit the error at the end.
 * Renders nothing while card status is unknown or when a card exists.
 */
export function AddCardBanner() {
  const { user } = useAuth();
  const { data: stripeConfig } = useStripeConfig();
  const [, navigate] = useLocation();

  // A card is REQUIRED to book only in lean (card-only) mode — with the wallet
  // enabled a rider can pay from balance, so don't claim a card is mandatory.
  const cardRequired =
    stripeConfig?.enabled && stripeConfig?.cardOnFileEnabled && !stripeConfig?.walletEnabled;
  if (!cardRequired || user?.hasCardOnFile !== false) return null;

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
      data-testid="add-card-banner"
    >
      <CreditCard className="w-5 h-5 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Add a payment card to book</p>
        <p className="text-xs text-muted-foreground">
          Rides are charged to your card. Takes about a minute.
        </p>
      </div>
      <Button size="sm" onClick={() => navigate("/card-setup")} data-testid="button-add-card">
        Add card
      </Button>
    </div>
  );
}
