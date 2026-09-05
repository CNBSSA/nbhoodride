import { Phone } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * Nudge for accounts created before the phone number became required at
 * signup. Without a phone the driver cannot call the rider at pickup, SOS
 * cannot text their emergency contact, and "reset password by text" has
 * nowhere to send the code. Renders nothing once a phone is on file.
 */
export function AddPhoneBanner({ onAdd }: { onAdd?: () => void }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  if (!user || user.phone) return null;
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
      data-testid="add-phone-banner"
    >
      <Phone className="w-5 h-5 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Add your phone number</p>
        <p className="text-xs text-muted-foreground">
          So your driver can reach you at pickup — and so you can recover your password by text.
        </p>
      </div>
      <Button size="sm" onClick={() => (onAdd ? onAdd() : navigate("/profile"))} data-testid="button-add-phone">
        Add phone
      </Button>
    </div>
  );
}
