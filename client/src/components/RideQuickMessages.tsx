import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { QUICK_RIDE_MESSAGES, type QuickRideMessageKey } from "@shared/quickRideMessages";
import { useToast } from "@/hooks/use-toast";

interface RideQuickMessagesProps {
  rideId: string;
  role: "rider" | "driver";
}

export function RideQuickMessages({ rideId, role }: RideQuickMessagesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sendMutation = useMutation({
    mutationFn: async (messageKey: QuickRideMessageKey) => {
      const res = await apiRequest("POST", `/api/rides/${rideId}/quick-message`, { messageKey });
      return res.json() as Promise<{ ok: boolean; text: string; message?: { id: string } }>;
    },
    onSuccess: (data) => {
      toast({ title: "Sent", description: data.text });
      queryClient.invalidateQueries({ queryKey: ["/api/rides", rideId, "messages"] });
    },
    onError: () => {
      toast({ title: "Could not send", description: "Try again.", variant: "destructive" });
    },
  });

  const keys = (Object.keys(QUICK_RIDE_MESSAGES) as QuickRideMessageKey[]).filter(
    (k) => QUICK_RIDE_MESSAGES[k].from === role,
  );

  return (
    <div className="flex flex-wrap gap-2" data-testid={`quick-messages-${role}`}>
      {keys.map((key) => (
        <Button
          key={key}
          type="button"
          size="sm"
          variant="secondary"
          disabled={sendMutation.isPending}
          onClick={() => sendMutation.mutate(key)}
          data-testid={`quick-msg-${key}`}
        >
          {QUICK_RIDE_MESSAGES[key].label}
        </Button>
      ))}
    </div>
  );
}
