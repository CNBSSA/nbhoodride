import { LOCALE_OPTIONS, type Locale } from "@shared/i18n";
import { useLocale } from "@/hooks/useLocale";

interface LanguageSelectorProps {
  value: string;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
}

/** E7 — Language preference selector. */
export function LanguageSelector({ value, onChange, disabled }: LanguageSelectorProps) {
  const { translate } = useLocale();

  return (
    <div className="space-y-2" data-testid="language-selector">
      <p className="text-sm font-medium">{translate("language.title")}</p>
      <div className="grid gap-2">
        {LOCALE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`text-left rounded-xl border p-3 text-sm transition-colors ${
              value === opt.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
            }`}
            data-testid={`lang-${opt.value}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
