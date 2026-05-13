import * as React from "react";

// Matrix primitives. Lifted from VS Pro
// (src/components/sourcing/matrix/primitives.tsx) with HQ design-token swaps
// per Phase 4.6-port spec § 1 substitutions:
//   - VS Pro `bg-[hsl(var(--surface))]`   (sticky-cell bg)   -> HQ `bg-surface-alt`
//   - VS Pro `bg-[hsl(var(--surface-2))]` (row hover, focus) -> HQ `bg-input`
//   - VS Pro `bg-[hsl(var(--bg-elevated))]` (header strip)   -> HQ `bg-surface`
//     (NOT `bg-secondary/30` like the list-view header strips in 4.2 /
//     4.4 — sticky col headers need an OPAQUE background or the
//     horizontal-scroll columns bleed through. HQ `--surface` is 0 0% 4%,
//     matching VS Pro `--bg-elevated` exactly.)
// Type-pill rgba palette + rank-tier hex colors are KEPT verbatim (port plan
// § 4 fidelity rule; HQ doesn't redefine these and the desaturated palette
// is part of the intentional matrix visual language).

import {
  CANONICAL_TYPES,
  type CanonicalType,
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  parseTypes,
  canonicalizeType,
} from "@/lib/venue-scout/venueTypes";
import {
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Re-export so matrix consumers (SourcingReport, Shortlist) can import
// everything from a single module, matching VS Pro's import shape.
export { CANONICAL_TYPES, TYPE_STYLES, TYPE_FALLBACK_STYLE, parseTypes, canonicalizeType };
export type { CanonicalType };

export type RankTier = "green" | "yellow" | "red" | "gray";
export function rankBucket(score: number | null): RankTier {
  if (score == null) return "gray";
  if (score >= 85) return "green";
  if (score >= 70) return "yellow";
  return "red";
}
export const RANK_TEXT: Record<RankTier, string> = {
  green: "text-[#4ade80]",
  yellow: "text-[#f59e0b]",
  red: "text-[#ef4444]",
  gray: "text-[#555]",
};
export const RANK_BAR: Record<RankTier, string> = {
  green: "bg-[#4ade80]",
  yellow: "bg-[#f59e0b]",
  red: "bg-[#ef4444]",
  gray: "bg-[#555]",
};

export function Pill({
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

export function VStack({
  top,
  bot,
  asAlign = false,
  dividerPad = 0,
  dividerRight = null,
}: {
  top: React.ReactNode;
  bot: React.ReactNode;
  asAlign?: boolean;
  dividerPad?: number;
  dividerRight?: React.ReactNode;
}) {
  const topPad = 6 + dividerPad;
  const botPad = (asAlign ? 12 : 6) + dividerPad;
  return (
    <div className={`h-full flex flex-col ${asAlign ? "" : "justify-center"}`}>
      <div
        style={{ paddingBottom: topPad }}
        className={`flex flex-col items-center text-center relative ${asAlign ? "flex-[8_1_0] justify-center" : "flex-none justify-end"}`}
      >
        {top}
      </div>
      <div className="relative w-1/2 mx-auto h-px bg-[#333]">
        {dividerRight ? (
          <div className="absolute left-full top-1/2 -translate-y-1/2 pl-1 flex items-center">
            {dividerRight}
          </div>
        ) : null}
      </div>
      <div
        style={{ paddingTop: botPad }}
        className={`flex flex-col items-center text-center ${asAlign ? "flex-[2_1_0] justify-center" : "flex-none justify-start"}`}
      >
        {bot}
      </div>
    </div>
  );
}

export function HdrStack({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span>{a}</span>
      <span className="w-1/2 h-px bg-border" />
      <span>{b}</span>
    </div>
  );
}

export type StickyCol = "col1" | "col2";
const STICKY_TH: Record<StickyCol, string> = {
  col1: "sticky left-0 z-30 shadow-none",
  col2: "sticky left-[60px] z-30 shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
};
// HQ token swap: VS Pro pins sticky cells against `bg-[hsl(var(--surface))]`.
// HQ's matrix container uses `bg-surface-alt` for the inner subtle surface
// (design-system § 12 rule 1), so sticky cells inherit the same color and the
// pinned columns visually merge with the body.
const STICKY_TD: Record<StickyCol, string> = {
  col1: "sticky left-0 z-10 bg-surface-alt",
  col2: "sticky left-[60px] z-10 bg-surface-alt shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]",
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
      className={`bg-surface text-subtle text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-[14px] border-b border-border border-r border-border text-center align-middle leading-[1.25] matrix-th-text last:border-r-0 ${s}`}
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
  const px = noPadX ? "px-[2px]" : "px-3";
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
    <ul className="bullets">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

export function RankDisplay({ score }: { score: number | null }) {
  const bucket = rankBucket(score);
  return (
    <div className="text-center w-full">
      <div
        className={`text-[18px] font-extrabold leading-none mb-[6px] tracking-[-0.01em] ${RANK_TEXT[bucket]}`}
      >
        {score ?? "-"}
        <span className="font-normal opacity-50 text-[14px]"> / 100</span>
      </div>
      <div className="h-[4px] w-1/2 mx-auto rounded-full bg-input overflow-hidden">
        <div
          className={`h-full ${RANK_BAR[bucket]}`}
          style={{ width: `${Math.min(score ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function NotesCellButton({
  note,
  onClick,
}: {
  note: string | undefined | null;
  onClick: () => void;
}) {
  if (note) {
    return (
      <button onClick={onClick} className="notes-cell">
        <span className="ico">✎</span>{note}
      </button>
    );
  }
  return (
    <button onClick={onClick} className="notes-cell-empty">+ Add Notes</button>
  );
}

// Phase 4.10.2-port: `EditableVenueName` generalized into `EditableField` so
// the same contenteditable behavior is reused for name + address +
// neighborhood (and any future single-line editable cell). The original
// `EditableVenueName` is kept as a thin wrapper for backward compatibility
// (no call sites broken if anything outside the matrix imports it).
export type EditableFieldVariant = "name" | "address" | "neighborhood";

const EDITABLE_VARIANT_CLASSES: Record<EditableFieldVariant, string> = {
  name: "text-[16px] font-bold leading-[1.25] text-foreground",
  address: "text-[12px] text-muted-foreground leading-[1.4]",
  neighborhood: "text-[12.5px] text-foreground leading-[1.4]",
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
  const ref = React.useRef<HTMLSpanElement>(null);
  // Imperatively keep textContent in sync with `value` only when the prop
  // differs from the current DOM text. Skips re-writing while the user is
  // typing (DOM == prop during a normal input cycle), and survives external
  // state revert (e.g. save failure rolls the venue back).
  React.useEffect(() => {
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [id, value]);
  // Phase 4.10.2-port: optional autofocus, used by the manual-add row on
  // Shortlist to drop the cursor into the new row's name field on insert.
  React.useEffect(() => {
    if (autoFocusOnMount && ref.current) {
      ref.current.focus();
    }
    // Intentionally empty deps: fire once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="max-w-full px-2 text-center">
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder ?? ""}
        onInput={(e) => onChange((e.currentTarget.textContent ?? "").trim())}
        className={`bg-transparent border border-transparent rounded px-1 py-[2px] hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors break-words [overflow-wrap:anywhere] inline empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40 ${EDITABLE_VARIANT_CLASSES[variant]}`}
      />
    </div>
  );
}

// Backward-compatible wrapper. EditableVenueName predates EditableField; keep
// the same shape so any existing import keeps working without a rename.
export function EditableVenueName({
  id,
  name,
  onChange,
}: {
  id: string;
  name: string;
  onChange: (next: string) => void;
}) {
  return (
    <EditableField
      id={id}
      value={name}
      onChange={onChange}
      variant="name"
      placeholder="Venue name"
    />
  );
}

// Phase 4.10.2-port: textarea-based editable for long-form fields and the
// Features column on SourcingReport + Shortlist. Contenteditable handles
// single-line cells well but gets clumsy for multi-line free text;
// `<textarea>` is the right primitive there.
//
// Imperative-sync pattern (mirrors EditableField): the textarea is
// uncontrolled at the DOM level (`defaultValue` for first mount), but a
// useEffect compares the textarea's current `value` against the prop and
// imperatively overwrites only when they differ. That way:
//   - typing produces onChange -> parent state update -> next render passes
//     the same value back; the effect skip-while-equal preserves the caret.
//   - an out-of-band revert (e.g. load() after a save error rolls the venue
//     back) does differ from the textarea's stale value, so the effect
//     pushes the corrected value back into the DOM. Caret is lost on
//     revert, which is acceptable because the producer's typed value was
//     itself the rejected write.
export function EditableTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.value !== value) {
      ref.current.value = value;
    }
  }, [id, value]);
  return (
    <textarea
      ref={ref}
      defaultValue={value}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className="ghost-input w-full text-[12.5px] leading-relaxed resize-none overflow-y-auto"
    />
  );
}

// Phase 4.10.2-port: source-of-origin pill. Replaces the hardcoded "Manual"
// label that used to live on Shortlist's manual rows. Three labels mapped to
// the three `vs_candidate_venues.source` values:
//   - 'sheet'    -> "Uploaded" (amber)
//   - 'research' -> "Sourced"  (muted gray)
//   - 'manual'   -> "Manual"   (electric blue, matches the ReferralPill
//                   convention from Talent Scout per design-system § 12)
// Rendered at the bottom of <VenueIdentityStack> on SourcingReport +
// Shortlist; NOT rendered on DeckPrep (producer is past sourcing-origin
// distinction at deck-prep time).
type SourceValue = "sheet" | "research" | "manual";

const SOURCE_LABEL: Record<SourceValue, string> = {
  sheet: "Uploaded",
  research: "Sourced",
  manual: "Manual",
};

const SOURCE_PILL_CLASSES: Record<SourceValue, string> = {
  sheet: "bg-amber-400/10 text-amber-400 border-amber-400/30",
  research: "bg-input text-muted-foreground border-border",
  manual: "bg-blue-400/10 text-blue-300 border-blue-400/30",
};

const SOURCE_PILL_BASE =
  "inline-flex items-center px-2 py-[2px] rounded-[3px] text-[9px] font-bold uppercase tracking-[0.12em] leading-[1.2] border whitespace-nowrap";

export function SourcePill({ source }: { source: string | null }) {
  // Defensive fallback: any non-canonical value (incl. null / undefined) reads
  // as "Manual". Producer-typed manual rows are the most likely null path
  // since the legacy schema accepted nullable source on insert.
  const key = (
    source === "sheet" || source === "research" || source === "manual"
      ? source
      : "manual"
  ) as SourceValue;
  return (
    <span className={`${SOURCE_PILL_BASE} ${SOURCE_PILL_CLASSES[key]}`}>
      {SOURCE_LABEL[key]}
    </span>
  );
}

// Phase 4.10.2-port: vertical stack for the Venue | Address cell (col2 on
// SourcingReport + Shortlist). Replaces the old 2-element VStack for that
// cell to absorb Rank + Source pill from the removed Alignment column.
//
// Phase 4.10.4-port: rank line dropped from the stack render. Rank is a
// reversible UI hide; the DB column + tool emission + patch-write paths all
// stay (per spec § 4a). The `rank` prop was also removed from this
// component's signature (no caller passes it through anymore); the matrix
// `RankDisplay` primitive is kept in this module so a future re-enable
// only has to add the prop back + drop the call back into the stack.
//
// New layout: name -> address -> divider -> website (if any) -> divider ->
// source pill. The middle divider above the source pill collapses out
// because rank is gone, so the bottom of the stack reads: divider ->
// source pill (no divider between since the 24px gap + pill color already
// reads as a footer-tag).
export function VenueIdentityStack({
  venueId,
  name,
  onNameChange,
  address,
  onAddressChange,
  website,
  source,
  autoFocusName = false,
}: {
  venueId: string;
  name: string;
  onNameChange: (next: string) => void;
  address: string;
  onAddressChange: (next: string) => void;
  website: string | null;
  source: string | null;
  autoFocusName?: boolean;
}) {
  return (
    <div className="h-full flex flex-col justify-center px-2 py-5 gap-[24px]">
      {/* Name + Address wrapped in their own flex column so the gap
          between them is TIGHT (4px) -- they read as one venue-identity
          block. The parent's 24px gap still applies between this block
          and the next divider so the overall stack rhythm holds. */}
      <div className="flex flex-col gap-[4px]">
        <EditableField
          id={`${venueId}-name`}
          value={name}
          onChange={onNameChange}
          variant="name"
          placeholder="Venue name"
          autoFocusOnMount={autoFocusName}
        />
        <EditableField
          id={`${venueId}-addr`}
          value={address}
          onChange={onAddressChange}
          variant="address"
          placeholder="(no address)"
        />
      </div>

      {/* Website (own row + divider so it sits in the same rhythm as the
          other stack elements; only rendered when a URL is present) */}
      {website ? (
        <>
          <StackDivider />
          <div className="flex justify-center">
            <WebsiteArrow url={website} />
          </div>
        </>
      ) : null}
      <StackDivider />

      {/* Source pill (no divider above; the 24px gap from the flex
          container is the breathing room). */}
      <div className="flex justify-center">
        <SourcePill source={source} />
      </div>
    </div>
  );
}

function StackDivider() {
  return <div className="w-1/2 mx-auto h-px bg-[#333]" />;
}

export function WebsiteArrow({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open website"
      className="inline-flex items-center gap-[3px] text-[12px] font-semibold uppercase tracking-[0.06em] text-primary hover:text-white transition-colors"
    >
      Website
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M7 17 17 7" /><path d="M8 7h9v9" />
      </svg>
    </a>
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
// UX: click the type-pill cell -> popover with the 8 canonical types as
// toggleable checkboxes. Active types are pre-checked. Toggle returns a new
// CanonicalType[]; the caller serializes to `${types.join(" / ")}` or null
// and persists via debounceSave.
//
// Empty state shows a muted "+ Set type" placeholder so the affordance is
// discoverable on manual rows that come in with venue_type=null.
export function TypeTogglePopover({
  currentTypes,
  onChange,
}: {
  currentTypes: CanonicalType[];
  onChange: (next: CanonicalType[]) => void;
}) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center gap-[7px] cursor-pointer hover:opacity-80 transition-opacity"
        >
          {currentTypes.length > 0 ? (
            currentTypes.map((t, i) => (
              <Pill
                key={`${t}-${i}`}
                className={TYPE_STYLES[t] ?? TYPE_FALLBACK_STYLE}
              >
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
          {CANONICAL_TYPES.map((t) => {
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
