import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";
import { useGeocodeSuggest, type AddressSuggestion } from "@/hooks/useGeocode";

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user PICKS a suggestion — gives you resolved coordinates. */
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
  autoFocus?: boolean;
}

/**
 * Address input with a live suggestion dropdown. As the user types, it shows
 * up to 5 matching addresses (server-proxied geocode). Picking one resolves
 * exact coordinates via onSelect — so the rider confirms the right place
 * instead of the app silently guessing.
 *
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Enter an address",
  className,
  disabled,
  autoFocus,
  ...rest
}: AddressAutocompleteProps) {
  const testId = rest["data-testid"];
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  // Suppress suggestions immediately after a pick so the dropdown doesn't
  // re-open with the just-selected label still in the box.
  const justPickedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { suggestions, loading } = useGeocodeSuggest(value, {
    enabled: open && !justPickedRef.current,
  });

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActiveIdx(-1);
  }, [suggestions]);

  const pick = (s: AddressSuggestion) => {
    justPickedRef.current = true;
    onChange(s.label);
    onSelect(s);
    setOpen(false);
    setActiveIdx(-1);
  };

  const showDropdown = open && !justPickedRef.current && value.trim().length >= 3;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          justPickedRef.current = false;
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showDropdown || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            pick(suggestions[activeIdx]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={testId}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
      )}
      {showDropdown && (suggestions.length > 0 || (!loading && value.trim().length >= 3)) && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {suggestions.length === 0 && !loading ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">
              No matching address — keep typing
            </div>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={`${s.lat},${s.lng},${i}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-gray-50 last:border-0 ${
                  i === activeIdx ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                data-testid={testId ? `${testId}-option-${i}` : undefined}
              >
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-gray-700 leading-snug">{s.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
