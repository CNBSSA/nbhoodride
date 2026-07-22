import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Users } from "lucide-react";

interface RideForFriendFieldsProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  passengerName: string;
  onPassengerNameChange: (v: string) => void;
  passengerPhone: string;
  onPassengerPhoneChange: (v: string) => void;
}

/** Book a ride for someone else — you pay; they ride. */
export function RideForFriendFields({
  enabled,
  onEnabledChange,
  passengerName,
  onPassengerNameChange,
  passengerPhone,
  onPassengerPhoneChange,
}: RideForFriendFieldsProps) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3" data-testid="ride-for-friend-fields">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
          <Users className="w-4 h-4" />
          Ride for someone else
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          data-testid="switch-ride-for-friend"
        />
      </div>
      {enabled && (
        <div className="space-y-2">
          <div>
            <Label htmlFor="passenger-name" className="text-xs">Passenger name</Label>
            <Input
              id="passenger-name"
              value={passengerName}
              onChange={(e) => onPassengerNameChange(e.target.value)}
              placeholder="Who is riding?"
              className="h-9 text-sm mt-1"
              data-testid="input-passenger-name"
            />
          </div>
          <div>
            <Label htmlFor="passenger-phone" className="text-xs">Passenger phone (optional)</Label>
            <Input
              id="passenger-phone"
              type="tel"
              value={passengerPhone}
              onChange={(e) => onPassengerPhoneChange(e.target.value)}
              placeholder="Driver can call if needed"
              className="h-9 text-sm mt-1"
              data-testid="input-passenger-phone"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            You pay with your PG Card. The driver will see who to pick up.
          </p>
        </div>
      )}
    </div>
  );
}
