import { cn } from "@/lib/utils";

const SEPARATION_OPTIONS = [
  { value: 0, label: "Open", description: "Any verified driver (fastest)" },
  { value: 1, label: "1st degree", description: "Drivers you've ridden with before" },
  { value: 2, label: "Within 2 degrees", description: "Neighbors in your trust network" },
] as const;

interface TrustPreferencesProps {
  maxSeparationDegrees: number;
  preferFavorites: boolean;
  onChangeSeparation: (value: number) => void;
  onChangePreferFavorites: (value: boolean) => void;
  disabled?: boolean;
}

/** C3 — Degrees-of-separation filter + favorite preference. */
export function TrustPreferences({
  maxSeparationDegrees,
  preferFavorites,
  onChangeSeparation,
  onChangePreferFavorites,
  disabled,
}: TrustPreferencesProps) {
  return (
    <div className="space-y-4" data-testid="trust-preferences">
      <div>
        <p className="text-sm font-medium mb-2">Who can pick you up?</p>
        <div className="grid gap-2">
          {SEPARATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChangeSeparation(opt.value)}
              className={cn(
                "text-left rounded-xl border p-3 transition-colors",
                maxSeparationDegrees === opt.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/50",
              )}
              data-testid={`separation-${opt.value}`}
            >
              <p className="text-sm font-semibold">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Prefer favorite drivers when available</span>
        <input
          type="checkbox"
          checked={preferFavorites}
          disabled={disabled}
          onChange={(e) => onChangePreferFavorites(e.target.checked)}
          data-testid="toggle-prefer-favorites"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Trust scores combine ride history, favorites, ratings, and verified neighbor status.
      </p>
    </div>
  );
}
