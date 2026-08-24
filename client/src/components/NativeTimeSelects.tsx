/**
 * Native <select>-based time picker (hour : minute AM/PM).
 *
 * Deliberately NOT the Radix/shadcn Select: those render their dropdown in a
 * floating portal that must be positioned and that pointer-locks the rest of
 * the page while open. Inside our full-screen booking sheets, on some real
 * phones (in-app browsers, WebViews, display-zoom setups) that dropdown could
 * end up invisible/off-screen — the sheet then looked frozen: time couldn't be
 * set and every other control stopped responding. Field report: 2026-08-24.
 *
 * Native selects sidestep the whole class of problem — the OS renders the
 * picker itself. Nothing to position, nothing to lock, works in every browser.
 */

export const nativeSelectClass =
  "h-10 rounded-md border border-input bg-background px-2 text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50";

interface NativeTimeSelectsProps {
  hour: string;
  minute: string;
  period: "AM" | "PM";
  onHourChange: (v: string) => void;
  onMinuteChange: (v: string) => void;
  onPeriodChange: (v: "AM" | "PM") => void;
  /** Hour option values — kept caller-specific ("01".."12" vs "1".."12") so existing schedule math is untouched. */
  hourOptions: string[];
  /** data-testid values, matching what each sheet used before. */
  testIds: { hour: string; minute: string; period: string };
}

export function NativeTimeSelects({
  hour,
  minute,
  period,
  onHourChange,
  onMinuteChange,
  onPeriodChange,
  hourOptions,
  testIds,
}: NativeTimeSelectsProps) {
  return (
    <div className="flex items-center gap-2">
      <select
        className={`${nativeSelectClass} flex-1 min-w-16`}
        value={hour}
        onChange={(e) => onHourChange(e.target.value)}
        aria-label="Hour"
        data-testid={testIds.hour}
      >
        {hourOptions.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span aria-hidden>:</span>
      <select
        className={`${nativeSelectClass} w-20`}
        value={minute}
        onChange={(e) => onMinuteChange(e.target.value)}
        aria-label="Minutes"
        data-testid={testIds.minute}
      >
        {["00", "15", "30", "45"].map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        className={`${nativeSelectClass} w-20`}
        value={period}
        onChange={(e) => onPeriodChange(e.target.value as "AM" | "PM")}
        aria-label="AM or PM"
        data-testid={testIds.period}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
