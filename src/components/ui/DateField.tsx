// Phase 6.3: ISO single-or-range date picker for HQ Core (Projects).
//
// Sibling of `DateRangePicker` (src/components/ui/DateRangePicker.tsx), NOT a
// replacement. DateRangePicker has a formatted-display-STRING contract because
// its only consumers are the Venue Scout brief surfaces whose date column is
// freeform text. This component has an ISO `{ start, end }` contract so it can
// drive HQ's real `date` columns (e.g. install_dates_start/_end). The small
// duplication between the two is deliberate: the contracts are genuinely
// different (freeform string vs ISO date columns), and keeping them separate
// keeps VS out of this picker's blast radius.
//
// Convention (locked, no migration): single date = `start` set + `end` null;
// range = both set. Readers (ProjectsList, queries.ts, Calendar banners,
// Timeline) already render a single date when end is null.
//
// Draft/commit semantics (load-bearing): the Calendar's onSelect updates ONLY
// an internal draft `DateRange` — it NEVER calls onChange. onChange fires only
// on Done (commit the draft) and Clear. In ProjectDetail this onChange persists
// straight to the DB, so firing on intermediate calendar clicks would write
// partial rows. The draft re-seeds from `value` every time the popover opens,
// so reopening shows the persisted value and an edit abandoned by closing
// without Done discards cleanly.
import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { parseIso, formatDateRange } from "@/lib/hq/dates";

export type DateFieldValue = { start: string | null; end: string | null }; // ISO YYYY-MM-DD
export type DateFieldProps = {
  value: DateFieldValue;
  onChange: (next: DateFieldValue) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Trigger styling. "input" (default) = canonical .input box, used in forms
   * (ProjectEdit). "inline" = the transparent inline-edit-read affordance the
   * other click-to-edit fields on detail cards use (ProjectDetail) — no border,
   * no surface fill, no coral left-border, no trigger icon; clearing is via the
   * popover footer. The .input box reads too heavy next to the borderless
   * sibling fields on a detail card.
   */
  variant?: "input" | "inline";
};

// Local-time ISO formatter — the inverse of `parseIso`. Built from getFullYear/
// getMonth/getDate (NOT toISOString) so a local-midnight Date never shifts a day
// across the UTC boundary on the way back to a column value.
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function valueToRange(value: DateFieldValue): DateRange | undefined {
  const from = parseIso(value.start);
  if (!from) return undefined;
  const to = parseIso(value.end);
  return to ? { from, to } : { from };
}

export function DateField({
  value,
  onChange,
  placeholder,
  disabled,
  variant = "input",
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    valueToRange(value),
  );
  // Controlled month so the calendar reopens to the selected date's month
  // (behavior G5.2), not always the current month.
  const [month, setMonth] = useState<Date>(
    () => parseIso(value.start) ?? new Date(),
  );

  const display = formatDateRange(value.start, value.end);
  const hasValue = Boolean(value.start || value.end);

  const clear = () => {
    setDraft(undefined);
    onChange({ start: null, end: null });
    setOpen(false);
  };

  // Done: commit the draft. Single (from only, or from === to) → end null;
  // genuine two-day range → both set; empty draft → both null.
  const commit = () => {
    if (!draft?.from) {
      onChange({ start: null, end: null });
    } else if (!draft.to || +draft.from === +draft.to) {
      onChange({ start: toIso(draft.from), end: null });
    } else {
      onChange({ start: toIso(draft.from), end: toIso(draft.to) });
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Re-seed the draft + month from the persisted value on every open.
        // Closing without Done (outside click / Esc) intentionally does NOT
        // commit — the abandoned draft is simply discarded on next open.
        if (next) {
          setDraft(valueToRange(value));
          setMonth(parseIso(value.start) ?? new Date());
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {variant === "inline" ? (
          // Detail-card affordance: transparent, matches the sibling
          // inline-edit fields. Clearing is via the popover footer.
          <button
            type="button"
            disabled={disabled}
            className="inline-edit-read"
            title="Click to edit"
            style={{
              border: "none",
              background: "transparent",
              font: "inherit",
              color: "inherit",
              textAlign: "left",
              cursor: disabled ? "not-allowed" : "pointer",
              maxWidth: "100%",
            }}
          >
            <span
              className={display ? undefined : "muted subtle"}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {display || placeholder || "Not set"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            className={`input ${value.start ? "input--filled" : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              textAlign: "left",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <span
              className={display ? undefined : "muted subtle"}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {display || placeholder || "Select dates"}
            </span>
            {/* Clear "X" appears only when a value is set. stopPropagation keeps
                the clear from re-opening the popover (behavior G5.3). */}
            {hasValue && !disabled ? (
              <span
                role="button"
                aria-label="Clear dates"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    clear();
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
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          month={month}
          onMonthChange={setMonth}
          selected={draft}
          // Only the draft moves on select — never onChange. Commit is Done.
          onSelect={setDraft}
          numberOfMonths={1}
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
          <Button type="button" variant="default" size="sm" onClick={commit}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
