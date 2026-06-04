import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";
import { useGeocodeSuggest, type GeocodeCandidate } from "@/hooks/useGeocode";

interface AddressAutocompleteProps {
  /** Current text input value. */
  value: string;
  /** Called when the user types. */
  onChange: (text: string) => void;
  /**
   * Called when the user picks a suggestion (or clears it). The component
   * does NOT call this on every keystroke — only when a candidate resolves
   * to coordinates. Pass null to mean "no resolved destination yet".
   */
  onSelect: (candidate: GeocodeCandidate | null) => void;
  placeholder?: string;
  className?: string;
  /** data-testid forwarded to the input. */
  testId?: string;
  /** Hide the dropdown entirely (useful when parent is in a "confirmed" state). */
  disabled?: boolean;
}

/**
 * Address input with a Mapbox/Nominatim-backed suggestion dropdown.
 *
 * UX: shows up to 5 candidates as you type. Clicking one fills the input
 * and calls onSelect with the candidate so parents can capture lat/lng.
 * Editing the input after a selection clears the resolved candidate so
 * stale coordinates can't be submitted.
 *
 * Replaces the per-modal copies of fetch(nominatim ...) that this codebase
 * had in five places — see docs/TODO-destination-geocoding.md for the
 * history.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  testId,
  disabled,
}: AddressAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // When a candidate has been chosen we suppress further geocoding until
  // the user starts editing again — keeps the dropdown from re-opening
  // while the value still matches the picked label.
  const { candidates, loading } = useGeocodeSuggest(
    hasSelection || disabled ? "" : value
  );

  useEffect(() => {
    if (disabled) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [disabled]);

  useEffect(() => {
    if (!disabled && !hasSelection && candidates.length > 0 && value.trim().length >= 3) {
      setOpen(true);
    } else if (candidates.length === 0) {
      setOpen(false);
    }
  }, [candidates, value, hasSelection, disabled]);

  function handleChange(next: string) {
    onChange(next);
    if (hasSelection) {
      // User is editing after a previous pick — invalidate the selection
      // so a stale (lat,lng) can't ride along with new typed text.
      setHasSelection(false);
      onSelect(null);
    }
  }

  function handlePick(candidate: GeocodeCandidate) {
    onChange(candidate.label);
    onSelect(candidate);
    setHasSelection(true);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testId}
        disabled={disabled}
        onFocus={() => {
          if (!disabled && candidates.length > 0) setOpen(true);
        }}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
      )}
      {open && candidates.length > 0 && (
        <div
          className="absolute z-50 mt-1 w-full bg-white rounded-md shadow-lg border border-gray-200 max-h-60 overflow-y-auto"
          data-testid={testId ? `${testId}-dropdown` : undefined}
        >
          {candidates.map((c, i) => (
            <button
              key={`${c.lat},${c.lng},${i}`}
              type="button"
              onClick={() => handlePick(c)}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 flex items-start gap-2 text-sm"
              data-testid={testId ? `${testId}-option-${i}` : undefined}
            >
              <MapPin className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-900">{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
