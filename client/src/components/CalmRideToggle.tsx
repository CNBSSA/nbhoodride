import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";

const MODES = [
  { value: "off", labelKey: "calm.off" as const },
  { value: "focus", labelKey: "calm.focus" as const },
  { value: "calm", labelKey: "calm.calm" as const },
  { value: "social", labelKey: "calm.social" as const },
  { value: "family", labelKey: "calm.family" as const },
];

interface CalmRideToggleProps {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
}

/** E6 — Calm Ride mode selector. */
export function CalmRideToggle({ value, onChange, disabled }: CalmRideToggleProps) {
  const { translate } = useLocale();

  return (
    <div className="space-y-2" data-testid="calm-ride-toggle">
      <p className="text-sm font-medium">{translate("calm.title")}</p>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m.value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              value === m.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted",
            )}
            data-testid={`calm-mode-${m.value}`}
          >
            {translate(m.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
