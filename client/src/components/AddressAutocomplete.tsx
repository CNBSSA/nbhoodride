import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, SearchX } from "lucide-react";
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
  /** Auto-focus the input on mount. Forwarded to the inner <Input />. */
  autoFocus?: boolean;
  /**
   * Label of an already-resolved address (i.e. the parent has destCoords
   * matching this label from a prior pick). When `value === resolvedLabel`
   * the component suppresses geocoding and dropdown, treating the address
   * as confirmed. This makes the component remount-safe — without it, a
   * remount with destinationAddress preserved but `hasSelection` reset
   * lets the user pick a DIFFERENT candidate while the parent still
   * trusts the original coords, silently mismatching (lat,lng) vs label.
   */
  resolvedLabel?: string;
}

/**
 * Address input with a Mapbox/Nominatim-backed suggestion dropdown.
 *
 * UX: shows up to 5 candidates as you type. Clicking one fills the input
 * and calls onSelect with the candidate so parents can capture lat/lng.
 * Editing the input after a selection clears the resolved candidate so
 * stale coordinates can't be submitted. If the geocoder returns zero
 * candidates for a non-trivial query, an explicit "No matching address"
 * empty-state replaces the silent failure that the previous version
 * shipped with — the very bug riders hit before the geocoder rewrite.
 *
 * Replaces the per-modal copies of fetch(nominatim ...) that this codebase
 * had in five places. forwardRef is required so callers can imperatively
 * focus the input (e.g., RiderDashboard's "Where to?" tile / window-event
 * triggers); without it, focus() on the ref silently no-ops.
 */
export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  function AddressAutocomplete(
    { value, onChange, onSelect, placeholder, className, testId, disabled, autoFocus, resolvedLabel },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [hasSelection, setHasSelection] = useState(false);
    // Index of the currently-highlighted suggestion for keyboard navigation.
    // -1 = no highlight (matches "no aria-activedescendant"). Reset whenever
    // the suggestion list or open-state changes so a stale index can't
    // outlive the candidates it pointed at.
    const [activeIndex, setActiveIndex] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Treat the address as already-resolved when either (a) the user just
    // picked a candidate this render cycle (hasSelection), or (b) the
    // parent says it's resolved via resolvedLabel matching value. The
    // latter survives remounts — without it, navigating away and back
    // would re-fire suggestions for the still-populated value and let
    // the user pick a different lat/lng while the parent's destCoords
    // stays put.
    const isResolved = hasSelection || (!!resolvedLabel && resolvedLabel === value);

    // When the address is treated as resolved we suppress geocoding so
    // the dropdown doesn't re-open against the picked value.
    const { candidates, loading } = useGeocodeSuggest(
      isResolved || disabled ? "" : value,
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
      if (!disabled && !isResolved && candidates.length > 0 && value.trim().length >= 3) {
        setOpen(true);
      } else if (candidates.length === 0) {
        setOpen(false);
      }
      // Always reset highlight when the list changes — keep stale indices
      // out of the picker.
      setActiveIndex(-1);
    }, [candidates, value, isResolved, disabled]);

    // Scroll the highlighted option into view (only when the list is open
    // and the user is navigating with arrow keys).
    useEffect(() => {
      if (!open || activeIndex < 0 || !listRef.current) return;
      const optionEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
      optionEl?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      if (disabled || isResolved) return;
      // Open the dropdown on ArrowDown even before the user has typed enough
      // to refresh suggestions — matches Uber/Lyft autocomplete UX.
      if (e.key === "ArrowDown") {
        if (candidates.length === 0) return;
        e.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex((i) => (i + 1) % candidates.length);
      } else if (e.key === "ArrowUp") {
        if (candidates.length === 0) return;
        e.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex((i) => (i <= 0 ? candidates.length - 1 : i - 1));
      } else if (e.key === "Enter") {
        if (!open || activeIndex < 0 || activeIndex >= candidates.length) return;
        e.preventDefault();
        handlePick(candidates[activeIndex]);
      } else if (e.key === "Escape") {
        if (!open) return;
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }

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

    // Show "no matching address" hint when the user has typed a real query
    // (>= 3 chars), the geocoder finished, and returned nothing. Without
    // this the dropdown silently stays closed and the user has no idea
    // why the Next/Book button is disabled — the exact failure mode
    // reported before this rewrite, just deferred to a different UI state.
    const showEmptyHint =
      !disabled && !isResolved && !loading && value.trim().length >= 3 && candidates.length === 0;

    const listboxId = testId ? `${testId}-listbox` : undefined;
    const activeOptionId =
      activeIndex >= 0 && testId ? `${testId}-option-${activeIndex}` : undefined;

    return (
      <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
        <Input
          ref={ref}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          data-testid={testId}
          disabled={disabled}
          autoFocus={autoFocus}
          // ARIA combobox pattern so screen readers can announce the
          // autocomplete and arrow-key navigation. Replaces the
          // previously-bare <input> that keyboard / SR users couldn't
          // operate at all.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && candidates.length > 0}
          aria-controls={open && candidates.length > 0 ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          onFocus={() => {
            if (!disabled && candidates.length > 0) setOpen(true);
          }}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
        )}
        {open && candidates.length > 0 && (
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="absolute z-50 mt-1 w-full bg-white rounded-md shadow-lg border border-gray-200 max-h-60 overflow-y-auto"
            data-testid={testId ? `${testId}-dropdown` : undefined}
          >
            {candidates.map((c, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={`${c.lat},${c.lng},${i}`}
                  id={testId ? `${testId}-option-${i}` : undefined}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handlePick(c)}
                  // Keyboard arrow navigation moves the highlight; mousing
                  // over an option also highlights it so the two stay
                  // visually consistent.
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 text-sm ${
                    isActive ? "bg-gray-100" : "hover:bg-gray-100"
                  }`}
                  data-testid={testId ? `${testId}-option-${i}` : undefined}
                >
                  <MapPin className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-900">{c.label}</span>
                </button>
              );
            })}
          </div>
        )}
        {showEmptyHint && (
          <div
            className="absolute z-50 mt-1 w-full bg-white rounded-md shadow-lg border border-gray-200 px-3 py-2 flex items-start gap-2 text-sm text-gray-500"
            data-testid={testId ? `${testId}-empty` : undefined}
          >
            <SearchX className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
            <span>No matching address. Try a more specific street, city, or landmark.</span>
          </div>
        )}
      </div>
    );
  },
);
