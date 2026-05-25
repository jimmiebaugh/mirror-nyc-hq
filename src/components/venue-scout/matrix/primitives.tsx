import * as React from "react";

// Matrix primitives. Lifted from VS Pro
// (src/components/sourcing/matrix/primitives.tsx) with HQ design-token swaps
// per Phase 4.6-port spec § 1 substitutions:
//   - VS Pro `bg-[hsl(var(--surface))]`   (sticky-cell bg)   -> HQ `bg-surface-alt`
//   - VS Pro `bg-[hsl(var(--surface-2))]` (row hover, focus) -> HQ `bg-input`
//   - VS Pro `bg-[hsl(var(--bg-elevated))]` (header strip)   -> HQ `bg-surface`
// Type-pill rgba palette + rank-tier hex colors are KEPT verbatim (port plan
// § 4 fidelity rule; HQ doesn't redefine these and the desaturated palette
// is part of the intentional matrix visual language).
//
// Phase 5.12.14 sweep: retired exports + re-exports per spec § 8.10.
// DELETED: RankTier / rankBucket / RANK_TEXT / RANK_BAR / RankDisplay /
// NotesCellButton / EditableTextarea / EditableVenueName / VenueIdentityStack
// / StackDivider / WebsiteArrow / HdrStack. Pill drops from exports but stays
// as an internal helper for TypeTogglePopover. The TYPE_STYLES /
// TYPE_FALLBACK_STYLE / parseTypes / CanonicalType re-exports drop; consumers
// import direct from `@/lib/venue-scout/venueTypes`.

import { useVenueTypes } from "@/lib/venue-scout/useVenueTypes";
import {
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function Pill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-[10px] py-[4px] rounded-[3px] text-[10.5px] font-bold uppercase tracking-[0.06em] leading-[1.2] whitespace-nowrap border ${className}`}
    >
      {children}
    </span>
  );
}

export type StickyCol = "col1" | "col2";
// Stage 2A: col-1 trims to 90px (content-fit — Database SourcePill + tight
// padding); sticky col-2 offset follows so the pinned Venue column docks
// flush during horizontal scroll.
const STICKY_TH: Record<StickyCol, string> = {
  col1: "sticky left-0 z-30 shadow-none",
  col2: "sticky left-[90px] z-30 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
};
// group-hover bg override: parent tr carries `group`, so when row hovers the
// sticky cells lift to a tint matching what non-sticky cells visually get from
// the tr's rgba(white,0.025) overlay (surface-alt #141414 + 2.5% white ≈ #1a1a1a
// = hsl(0 0% 10%)). Without this, sticky cells stay solid surface-alt while
// non-sticky cells lighten, breaking row-hover parity across the row.
const STICKY_TD: Record<StickyCol, string> = {
  col1: "sticky left-0 z-10 bg-surface-alt group-hover:bg-[hsl(0_0%_10%)]",
  col2: "sticky left-[90px] z-10 bg-surface-alt group-hover:bg-[hsl(0_0%_10%)] shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
};

export function Th({
  children,
  sticky,
}: {
  children: React.ReactNode;
  sticky?: StickyCol;
}) {
  const s = sticky ? STICKY_TH[sticky] : "";
  return (
    <th
      className={`bg-surface text-subtle text-[11px] font-bold uppercase tracking-[0.06em] px-[14px] py-[10px] border-b border-border border-r border-border text-center align-middle leading-[1.25] matrix-th-text last:border-r-0 ${s}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  vCenter = false,
  noPadX = false,
  noPadY = false,
  sticky,
}: {
  children: React.ReactNode;
  className?: string;
  vCenter?: boolean;
  noPadX?: boolean;
  noPadY?: boolean;
  sticky?: StickyCol;
}) {
  const px = noPadX ? "px-[2px]" : "px-[14px]";
  const py = noPadY ? "py-0" : "py-3";
  const va = vCenter ? "align-middle" : "align-top";
  const s = sticky ? STICKY_TD[sticky] : "";
  return (
    <td
      style={{ height: 1 }}
      className={`${px} ${py} ${va} ${s} ${className}`}
    >
      {children}
    </td>
  );
}

export function Bullets({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-muted-foreground">-</span>;
  return (
    <ul className="bullets text-left">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

// Phase 4.10.2-port: `EditableVenueName` generalized into `EditableField` so
// the same contenteditable behavior is reused for name + address +
// neighborhood (and any future single-line editable cell). Phase 5.12.14:
// the backward-compat `EditableVenueName` wrapper retired (no remaining
// consumers post-VenueIdentityStack removal).
//
// Phase 5.12.7 Feature C: `url` variant added for the inline website URL
// affordance on manual rows in SourcingReport. The url branch switches
// from contenteditable to a real `<input type="url">` so the browser
// surfaces its native URL keyboard / pattern hint; no blur-time validator
// (a frontend equivalent of the edge-side validateWebsiteUrl does not
// exist today, and a duplicated Deno HEAD check would not work from the
// browser anyway). Caller still owns persistence via the onChange prop.
export type EditableFieldVariant = "name" | "address" | "neighborhood" | "url";

// Stage 2A: VS matrix EditableField variants partially aligned with HQ
// /projects DataTable canon (index.css .tbl + .sub):
//   - name kept at the VS-original 16px bold (Jimmie's call — anchor element
//     of the cell, deliberately larger than canon). Max-width 225px so long
//     venue names wrap to a second line instead of stretching the col.
//   - address -> 12px subtle-foreground (smaller than VS-original 12px muted;
//     same size, lighter color per .sub-style). max-w-full so address tracks
//     its container (the shrink-to-fit inner stack at <=225px).
//   - neighborhood -> 13px (vestigial — actual neighborhood input renders via
//     RecordCombobox, not EditableField, so this only affects the contenteditable
//     fallback if it's ever reused).
//   - url unchanged.
const EDITABLE_VARIANT_CLASSES: Record<EditableFieldVariant, string> = {
  name: "text-[16px] font-bold leading-[1.25] text-foreground max-w-[225px]",
  address: "text-[12px] text-[hsl(var(--subtle-foreground))] leading-[1.4] max-w-full",
  neighborhood: "text-[13px] text-foreground leading-[1.4]",
  url: "text-[12px] text-foreground leading-[1.4]",
};

export function EditableField({
  id,
  value,
  onChange,
  variant = "name",
  placeholder,
  autoFocusOnMount = false,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  variant?: EditableFieldVariant;
  placeholder?: string;
  autoFocusOnMount?: boolean;
}) {
  const spanRef = React.useRef<HTMLSpanElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isUrlVariant = variant === "url";
  // Imperatively keep textContent in sync with `value` only when the prop
  // differs from the current DOM text. Skips re-writing while the user is
  // typing (DOM == prop during a normal input cycle), and survives external
  // state revert (e.g. save failure rolls the venue back).
  React.useEffect(() => {
    if (isUrlVariant) {
      if (inputRef.current && inputRef.current.value !== value) {
        inputRef.current.value = value;
      }
      return;
    }
    if (spanRef.current && spanRef.current.textContent !== value) {
      spanRef.current.textContent = value;
    }
  }, [id, value, isUrlVariant]);
  // Phase 4.10.2-port: optional autofocus, used by the manual-add row on
  // Shortlist to drop the cursor into the new row's name field on insert.
  React.useEffect(() => {
    if (!autoFocusOnMount) return;
    if (isUrlVariant) {
      inputRef.current?.focus();
    } else {
      spanRef.current?.focus();
    }
    // Intentionally empty deps: fire once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (isUrlVariant) {
    return (
      <div className="max-w-full px-2">
        <input
          ref={inputRef}
          type="url"
          defaultValue={value}
          spellCheck={false}
          placeholder={placeholder ?? "https://..."}
          onChange={(e) => onChange(e.currentTarget.value.trim())}
          className={`w-full bg-transparent border border-transparent rounded px-1 py-[2px] hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors placeholder:text-muted-foreground/40 ${EDITABLE_VARIANT_CLASSES.url}`}
        />
      </div>
    );
  }
  return (
    <div className="max-w-full px-2 text-center">
      <span
        ref={spanRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder ?? ""}
        onInput={(e) => onChange((e.currentTarget.textContent ?? "").trim())}
        className={`bg-transparent border border-transparent rounded px-0.5 py-[2px] hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors break-words [overflow-wrap:anywhere] inline-block empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40 ${EDITABLE_VARIANT_CLASSES[variant]}`}
      />
    </div>
  );
}

// Phase 4.10.2-port: source-of-origin pill. Replaces the hardcoded "Manual"
// label that used to live on Shortlist's manual rows. Four labels mapped to
// the four `vs_candidate_venues.source` values:
//   - 'sheet'    -> "Uploaded" (amber)
//   - 'research' -> "Sourced"  (muted gray)
//   - 'manual'   -> "Manual"   (electric blue)
//   - 'hq_pool'  -> "Database" (teal)
type SourceValue = "sheet" | "research" | "manual" | "hq_pool";

const SOURCE_LABEL: Record<SourceValue, string> = {
  sheet: "Uploaded",
  research: "Sourced",
  manual: "Manual",
  hq_pool: "Database",
};

const SOURCE_PILL_CLASSES: Record<SourceValue, string> = {
  sheet: "bg-amber-400/10 text-amber-400 border-amber-400/30",
  research: "bg-input text-muted-foreground border-border",
  manual: "bg-blue-400/10 text-blue-300 border-blue-400/30",
  hq_pool:
    "bg-[rgba(104,168,160,0.18)] text-[#7ECCB8] border-[rgba(104,168,160,0.42)]",
};

const SOURCE_PILL_BASE =
  "inline-flex items-center px-2 py-[2px] rounded-[3px] text-[9px] font-bold uppercase tracking-[0.12em] leading-[1.2] border whitespace-nowrap";

export function SourcePill({ source }: { source: string | null }) {
  // Defensive fallback: any non-canonical value (incl. null / undefined) reads
  // as "Manual". Producer-typed manual rows are the most likely null path
  // since the legacy schema accepted nullable source on insert.
  const key = (
    source === "sheet" ||
    source === "research" ||
    source === "manual" ||
    source === "hq_pool"
      ? source
      : "manual"
  ) as SourceValue;
  return (
    <span className={`${SOURCE_PILL_BASE} ${SOURCE_PILL_CLASSES[key]}`}>
      {SOURCE_LABEL[key]}
    </span>
  );
}

// Phase 4.10.3-port: producer-editable venue_type cell.
//
// 4.10.2 collapsed manual-row inputs into the shared VenueIdentityStack
// pattern and the manual `<input>` for type went with it. The producer's
// path to set venue_type on any row disappeared. Per the port-plan locked
// direction (all rows editable except recs/considerations), this brings
// type editing back across the matrix.
//
// Phase 5.12.10: signature widened from CanonicalType[] to string[] so
// producer-added runtime types (read via useVenueTypes) flow through
// without a type assertion. The checkbox list = union of the runtime
// set + any currently-stored tokens that aren't in the runtime set
// (stale tokens render at the end of the list, pre-checked, with
// TYPE_FALLBACK_STYLE so producers can uncheck stored-but-removed
// types). Pill colors use paletteFor(t) from useVenueTypes which falls
// back to TYPE_FALLBACK_STYLE for non-palette-key types.
//
// UX: click the type-pill cell -> popover with the runtime types as
// toggleable checkboxes. Active types are pre-checked. Toggle returns
// a new string[]; the caller serializes to `${types.join(" / ")}` or
// null and persists via debounceSave.
//
// Empty state shows a muted "+ Set type" placeholder so the affordance
// is discoverable on manual rows that come in with venue_type=null.
//
// Phase 5.12.14: horizontal variant enforces max-2-per-row via a
// deterministic `grid grid-cols-2` wrapper when >= 2 pills are present;
// single-pill renders plain centered (no grid) so a lone pill doesn't
// dangle off-balance in a 2-col grid.
export function TypeTogglePopover({
  currentTypes,
  onChange,
  direction = "vertical",
}: {
  currentTypes: string[];
  onChange: (next: string[]) => void;
  direction?: "vertical" | "horizontal";
}) {
  const { names: availableTypes, paletteFor } = useVenueTypes();
  // Phase 5.12.10: union the runtime set with any currently-stored
  // tokens that aren't in the runtime set (admin-deleted types still
  // on this row; producer-added types not yet flushed to cache).
  // Without this union, a stale token renders as a trigger pill but
  // has NO checkbox row, making it impossible to UNCHECK. Stale tokens
  // render at the END of the list, pre-checked, with TYPE_FALLBACK_STYLE.
  const stale = currentTypes.filter((t) => !availableTypes.includes(t));
  const togglerOptions = [...availableTypes, ...stale];
  const isHorizontal = direction === "horizontal";
  const triggerLayoutClass = isHorizontal
    ? "flex flex-row flex-wrap items-center justify-center gap-[6px]"
    : "flex flex-col items-center gap-[7px]";
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${triggerLayoutClass} cursor-pointer hover:opacity-80 transition-opacity`}
        >
          {currentTypes.length > 0 ? (
            currentTypes.map((t, i) => (
              <Pill key={`${t}-${i}`} className={paletteFor(t)}>
                {t}
              </Pill>
            ))
          ) : (
            <span className="text-muted-foreground text-[11px] italic">
              + Set type
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-2 bg-surface-alt border border-border"
        align="center"
      >
        <div className="space-y-1">
          {togglerOptions.map((t) => {
            const active = currentTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() =>
                  onChange(
                    active
                      ? currentTypes.filter((x) => x !== t)
                      : [...currentTypes, t],
                  )
                }
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left transition-colors ${
                  active
                    ? "bg-input text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-input/50"
                }`}
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  {active && <CheckIcon />}
                </span>
                {t}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
