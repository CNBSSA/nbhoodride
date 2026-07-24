import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { rebookRecurringSchedule } from "@/lib/saveRecurringSchedule";
import { queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface RecurringRebookBannerProps {
  scheduleId: string;
  label?: string;
  onDone?: () => void;
}

export function RecurringRebookBanner({ scheduleId, label, onDone }: RecurringRebookBannerProps) {
  const { toast } = useToast();
  const rebook = useMutation({
    mutationFn: () => rebookRecurringSchedule(scheduleId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rides/scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/circuits/timetable"] });
      toast({
        title: label ? `${label} booked` : "Recurring ride booked",
        description: data.message ?? "Check Upcoming rides.",
      });
      onDone?.();
    },
    onError: (err: Error) => {
      toast({
        title: "Could not book this week",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  return (
    <div
      className="mx-4 mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2"
      data-testid="recurring-rebook-banner"
    >
      <p className="text-sm font-semibold">Weekly ride reminder</p>
      <p className="text-xs text-muted-foreground">
        {label ? `Confirm your ${label} for this week.` : "Book this week's trip from your saved schedule."}
      </p>
      <Button
        size="sm"
        className="w-full"
        disabled={rebook.isPending}
        onClick={() => rebook.mutate()}
        data-testid="button-recurring-rebook"
      >
        {rebook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Book this week"}
      </Button>
    </div>
  );
}
