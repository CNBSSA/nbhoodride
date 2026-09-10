/**
 * What a driver is cleared for beyond ordinary rides. Granted here by the
 * operator after whatever the agreement and the insurer require; an
 * unbadged driver never sees that work on their board and cannot claim it.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { BADGE_LABELS, BADGE_REQUIREMENTS, DRIVER_BADGES, normalizeBadges, type DriverBadge } from "@shared/driverBadges";

export function DriverBadges({ userId, badges }: { userId: string; badges?: unknown }) {
  const { toast } = useToast();
  const [held, setHeld] = useState<DriverBadge[]>(() => normalizeBadges(badges));
  useEffect(() => { setHeld(normalizeBadges(badges)); }, [badges]);
  const save = useMutation({
    mutationFn: async (next: DriverBadge[]) => {
      const res = await apiRequest("PUT", `/api/admin/drivers/${userId}/badges`, { badges: next });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
      return data as { badges: DriverBadge[]; summary: string };
    },
    onSuccess: (r) => {
      setHeld(r.badges);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
      toast({ title: "Badges updated", description: r.summary });
    },
    onError: (e: Error) => { setHeld(normalizeBadges(badges)); toast({ title: "Could not update the badges", description: e.message, variant: "destructive" }); },
  });
  return (
    <div className="mt-2" data-testid={`driver-badges-${userId}`}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Cleared for</p>
      <div className="flex flex-wrap gap-2">
        {DRIVER_BADGES.map((b) => {
          const on = held.includes(b);
          return (
            <Button
              key={b}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              disabled={save.isPending}
              title={BADGE_REQUIREMENTS[b]}
              onClick={() => save.mutate(on ? held.filter((x) => x !== b) : [...held, b])}
              data-testid={`button-driver-badge-${b}-${userId}`}
            >
              {BADGE_LABELS[b]}
            </Button>
          );
        })}
        {held.length === 0 && <span className="text-xs text-muted-foreground self-center">Ordinary rides only</span>}
      </div>
    </div>
  );
}
