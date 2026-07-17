import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";
import { CALM_MODE_DESCRIPTIONS } from "@shared/userFacingCopy";

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
      <div
        className="flex flex-col gap-2"
        role="radiogroup"
        aria-label={translate("calm.title")}
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value === m.value}
            disabled={disabled}
            onClick={() => onChange(m.value)}
            className={cn(
              "text-left rounded-xl border px-3 py-2 transition-colors",
              value === m.value
                ? "bg-primary/5 border-primary ring-1 ring-primary"
                : "bg-background hover:bg-muted border-border",
            )}
            data-testid={`calm-mode-${m.value}`}
          >
            <span className="text-xs font-medium">{translate(m.labelKey)}</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {CALM_MODE_DESCRIPTIONS[m.value] ?? ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
