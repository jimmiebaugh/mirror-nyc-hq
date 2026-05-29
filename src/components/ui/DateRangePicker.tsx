// Phase 5.12.14: range-mode date picker built on shadcn's Calendar primitive
// (`src/components/ui/calendar.tsx`) which wraps `react-day-picker`. Used by
// Venue Scout brief intake + report pages for `live_dates`. (Install /
// strike dates retired in 5.12.14.3.)
//
// Storage shape is unchanged: the columns are still `text` and the picker
// commits a formatted display string (e.g. "Oct 15-17, 2026"). Downstream
// consumers (Claude prompts, Slides text replacement, list views) read the
// string as-is.
//
// Internal state contract:
//   - The picker holds its own `DateRange | undefined` state while the popover
//     is open. It does NOT round-trip every onSelect call through the parent's
//     formatted-string value — in range mode the first click emits a
//     `{from, to: undefined}` half-range that would get clobbered if we
//     re-derived state from a flattened string on every keystroke.
//   - `onChange` only fires when the range is complete (both `from` AND `to`
//     set), OR when the popover closes with a partial selection.
//   - `parseOwnFormat` round-trips the picker's own output shapes so reopening
//     the popover on a value the picker wrote seeds the Calendar with the
//     existing selection. Legacy free-text values (anything else) return
//     undefined; the trigger shows them as-is, popover opens empty.
import { useEffect, useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";

export type DateRangePickerProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDateParts(
  monthAbbr: string,
  day: string,
  year: string,
): Date | undefined {
  const m = MONTHS.indexOf(monthAbbr);
  if (m < 0) return undefined;
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (Number.isNaN(d) || Number.isNaN(y)) return undefined;
  return new Date(y, m, d);
}

// Parse/format helpers co-located with the picker that owns the format.
// eslint-disable-next-line react-refresh/only-export-components
export function parseOwnFormat(value: string): DateRange | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  // Single date: "Mon DD, YYYY"
  const singleMatch = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(trimmed);
  if (singleMatch) {
    const d = parseDateParts(singleMatch[1], singleMatch[2], singleMatch[3]);
    return d ? { from: d, to: d } : undefined;
  }
  // Range same month + year: "Mon DD-DD, YYYY"
  const sameMonthMatch = /^([A-Z][a-z]{2}) (\d{1,2})-(\d{1,2}), (\d{4})$/.exec(
    trimmed,
  );
  if (sameMonthMatch) {
    const from = parseDateParts(
      sameMonthMatch[1],
      sameMonthMatch[2],
      sameMonthMatch[4],
    );
    const to = parseDateParts(
      sameMonthMatch[1],
      sameMonthMatch[3],
      sameMonthMatch[4],
    );
    return from && to ? { from, to } : undefined;
  }
  // Range cross-month same year: "Mon DD - Mon DD, YYYY"
  const crossMonthMatch =
    /^([A-Z][a-z]{2}) (\d{1,2}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(
      trimmed,
    );
  if (crossMonthMatch) {
    const from = parseDateParts(
      crossMonthMatch[1],
      crossMonthMatch[2],
      crossMonthMatch[5],
    );
    const to = parseDateParts(
      crossMonthMatch[3],
      crossMonthMatch[4],
      crossMonthMatch[5],
    );
    return from && to ? { from, to } : undefined;
  }
  // Range cross-year: "Mon DD, YYYY - Mon DD, YYYY"
  const crossYearMatch =
    /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(
      trimmed,
    );
  if (crossYearMatch) {
    const from = parseDateParts(
      crossYearMatch[1],
      crossYearMatch[2],
      crossYearMatch[3],
    );
    const to = parseDateParts(
      crossYearMatch[4],
      crossYearMatch[5],
      crossYearMatch[6],
    );
    return from && to ? { from, to } : undefined;
  }
  return undefined;
}

// eslint-disable-next-line react-refresh/only-export-components
export function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return "";
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", opts).format(d);
  if (!range.to || +range.from === +range.to) {
    return fmt(range.from, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const fromYear = range.from.getFullYear();
  const toYear = range.to.getFullYear();
  const fromMonth = range.from.getMonth();
  const toMonth = range.to.getMonth();
  if (fromYear === toYear && fromMonth === toMonth) {
    // R6 § A.4: build the same-month suffix from getDate + getFullYear
    // directly instead of `Intl.DateTimeFormat({ day, year })`. The
    // partial-component Intl call rendered as `5/30/2026` in some en-US
    // runtimes, producing `May 28-5/30/2026` instead of `May 28-30, 2026`.
    return `${fmt(range.from, { month: "short", day: "numeric" })}-${range.to.getDate()}, ${toYear}`;
  }
  if (fromYear === toYear) {
    return `${fmt(range.from, {
      month: "short",
      day: "numeric",
    })} - ${fmt(range.to, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return `${fmt(range.from, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} - ${fmt(range.to, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder,
  disabled,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [internalRange, setInternalRange] = useState<DateRange | undefined>(
    undefined,
  );

  // Seed internal state from the stored value when the popover opens. Re-seed
  // only on open transitions, not on every value change, so the parent's
  // onChange-triggered re-render doesn't clobber an in-flight selection.
  useEffect(() => {
    if (open) {
      setInternalRange(parseOwnFormat(value));
    }
  }, [open, value]);

  const commit = (range: DateRange | undefined) => {
    onChange(formatRange(range));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && internalRange?.from && !internalRange.to) {
          commit(internalRange);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          <span
            className={value ? "text-foreground" : "text-muted-foreground"}
          >
            {value || placeholder || "Select dates"}
          </span>
          {/* Clear affordance: appears only when a value is set. Stops
              propagation so the Popover doesn't open on click. Without this
              the picker has no UI path back to the empty state (Codex audit:
              live/install/strike are optional fields). */}
          {value && !disabled ? (
            <span
              role="button"
              aria-label="Clear dates"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInternalRange(undefined);
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setInternalRange(undefined);
                  onChange("");
                }
              }}
              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={internalRange}
          onSelect={(range) => {
            setInternalRange(range);
            if (range?.from && range?.to) {
              commit(range);
              setOpen(false);
            }
          }}
          numberOfMonths={1}
        />
        {/* Footer: explicit Clear inside the popover for keyboard users
            and as a fallback if the trigger-side X doesn't get noticed. */}
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setInternalRange(undefined);
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
