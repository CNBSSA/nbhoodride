import { Switch } from "@/components/ui/switch";
import { Repeat } from "lucide-react";

interface RecurringWeeklyToggleProps {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  description?: string;
  testId?: string;
}

export function RecurringWeeklyToggle({
  checked,
  onCheckedChange,
  description = "Same day and time every week — we'll remind you to book.",
  testId = "toggle-recurring-weekly",
}: RecurringWeeklyToggleProps) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3"
      data-testid="recurring-weekly-toggle-row"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Repeat className="w-4 h-4 text-primary shrink-0" />
          Repeat every week
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
    </div>
  );
}
