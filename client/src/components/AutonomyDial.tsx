import { AUTONOMY_LEVELS } from "@shared/genui/schema";
import { cn } from "@/lib/utils";

interface AutonomyDialProps {
  level: number;
  onChange: (level: number) => void;
  disabled?: boolean;
}

/** B5 — Autonomy dial control for Profile settings. */
export function AutonomyDial({ level, onChange, disabled }: AutonomyDialProps) {
  return (
    <div className="space-y-3" data-testid="autonomy-dial">
      <p className="text-sm text-muted-foreground">
        How much PG Ride can do for you before asking to confirm.
      </p>
      <div className="grid gap-2">
        {AUTONOMY_LEVELS.map((opt) => (
          <button
            key={opt.level}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.level)}
            className={cn(
              "text-left rounded-xl border p-3 transition-colors",
              level === opt.level
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:bg-muted/50",
            )}
            data-testid={`autonomy-level-${opt.level}`}
          >
            <p className="text-sm font-semibold">{opt.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
