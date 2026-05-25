// Phase 5.12.15: per-venue presentational card for the consolidated
// Review surface. Split out of Review.tsx so the parent page stays
// at the size of today's DeckPrep parent (~600-700 lines instead of
// ~1300 if the card stayed inline). The card owns layout + every
// editable field + the photo grid + the Regenerate Overview button
// click affordance. Every persistence path routes through the
// parent's onSave + onRegenerate + onOpenPhotos callbacks; the card
// makes zero supabase calls.
//
// Post-smoke 2026-05-25 (Jimmie): top-bar cluster reshape (drag +
// checkbox + pill move to upper LEFT in that order, all 3 bumped
// in size); 3-sub-column body retired in favor of the FinalReview
// 2-column shape so the photo column gets full half-card width; new
// field order in the LEFT stack (Type, Address, Neighborhood/Size/
// Capacity on one row, Website, Overview with Regenerate inline
// right of the label, Notes/Feedback with label + coral placeholder
// + no explainer paragraph); local CardField helper renders labels
// at 12px (text-xs) rather than the shared Field's 10px.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, ExternalLink, GripVertical } from "lucide-react";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { TypeTogglePopover } from "@/components/venue-scout/matrix/primitives";
import { useVenueTypes } from "@/lib/venue-scout/useVenueTypes";
import { parseTypes } from "@/lib/venue-scout/venueTypes";

// Row shape mirrors the Venue type in Review.tsx but kept local so
// the card file doesn't import from a page module.
export type ReviewVenue = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  venue_type: string | null;
  size_sq_ft: number | null;
  capacity: number | null;
  website_url: string | null;
  venue_overview: string | null;
  notes: string | null;
};

// Patch shape the parent's debounceSave consumes.
export type ReviewVenuePatch = {
  name?: string;
  address?: string | null;
  neighborhood?: string | null;
  venue_type?: string | null;
  size_sq_ft?: number | null;
  capacity?: number | null;
  website_url?: string | null;
  venue_overview?: string | null;
  notes?: string | null;
};

const inputCls =
  "w-full bg-transparent border border-transparent rounded px-2 py-1 text-sm leading-snug text-foreground hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors";

// Same chrome as inputCls but min-h-[28px] instead of py-1 so the
// outer height matches the Neighborhood combobox wrapper's
// min-h-[28px]; the input's text vertically centers within that
// height via the browser's native single-line input behavior, so the
// baseline lines up with the combobox-trigger text in the same row.
const rowInputCls =
  "w-full bg-transparent border border-transparent rounded px-2 min-h-[28px] text-sm leading-snug text-foreground hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors";

// Phase 5.12.14.1 Stage 2C polish round: adopts the canonical `.label-form`
// (12px / 700 / 0.12em / mono / subtle-foreground per the post-Stage 2C
// sitewide letter-spacing canon).
function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label-form mb-1.5">{label}</div>
      {children}
    </div>
  );
}

export type ReviewCardProps = {
  venue: ReviewVenue;
  includedOrderNum: number | null;
  included: boolean;
  regenerating: boolean;
  photoCount: number;
  photoUrls: (string | null)[];
  scoutCity: string | null;
  scoutCityId: string | null;
  display: { size?: string; capacity?: string };
  // Phase 5.12.14.3 Round 3 amendment v2 § 3: one-position arrow
  // reorder. Drag-to-reorder still works via the GripVertical handle;
  // arrows are for precise single-step moves over tall cards.
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleInclude: (next: boolean) => void;
  onSave: (patch: ReviewVenuePatch) => void;
  onSaveSize: (raw: string) => void;
  onSaveCapacity: (raw: string) => void;
  onRegenerate: () => void;
  onOpenPhotos: () => void;
};

export function ReviewCard({
  venue: v,
  includedOrderNum,
  included,
  regenerating,
  photoCount,
  photoUrls,
  scoutCity,
  scoutCityId,
  display,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleInclude,
  onSave,
  onSaveSize,
  onSaveCapacity,
  onRegenerate,
  onOpenPhotos,
}: ReviewCardProps) {
  const sortable = useSortable({ id: v.id });
  // Phase 5.12.14.3 Round 3 amendment v3 § 2: inline `opacity` removed.
  // The v2 inline `opacity: 1` (not-dragging branch) won via CSS
  // specificity over Tailwind's `opacity-40` excluded-state class, so
  // excluded cards never dimmed. Inline style now carries only transform
  // + transition; opacity moves into conditional className below.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  // useVenueTypes() reads a shared module-level cache (see
  // project_useLookup_cache_architecture); calling it per-card is
  // cheap and avoids prop-drilling availableTypes.
  const { names: availableTypes } = useVenueTypes();
  const types = parseTypes(v.venue_type, availableTypes);

  return (
    // Phase 5.12.14.3 Round 3 § A: outer chrome swapped to canonical
    // `.card` + `.card-pad`. DnD wrapper (sortable.setNodeRef + transform
    // style), opacity dim on excluded, and data-included attribute all
    // preserved. Internal layout further refactored in Round 3 amendment
    // v1 § 1+2: 2-row top bar + opacity-40 dim.
    <section
      ref={sortable.setNodeRef}
      style={style}
      data-included={included ? "true" : "false"}
      className={`card transition-opacity ${
        sortable.isDragging
          ? "opacity-50"
          : included
            ? ""
            : "opacity-40"
      }`}
    >
      <div className="card-pad">
      {/* Row 1: drag handle + checkbox + Venue XX pill + up/down arrow
          reorder buttons as inline peers. Amendment v3 § 1: chevrons
          moved from between drag/checkbox to after the pill (right of
          the cluster) per producer review. */}
      <div className="flex items-center gap-3 mb-3">
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => onToggleInclude(e.target.checked)}
          // R6 § M.13: stop pointerdown from reaching dnd-kit's PointerSensor
          // (PointerSensor has activationConstraint distance: 5 but a slow
          // click on the checkbox still risks initiating a drag).
          onPointerDown={(e) => e.stopPropagation()}
          className="h-4 w-4 accent-primary cursor-pointer"
        />
        <span
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.14em] ${
            included
              ? "bg-primary text-primary-foreground"
              : "bg-input text-muted-foreground"
          }`}
        >
          {included && includedOrderNum != null
            ? `Venue ${String(includedOrderNum).padStart(2, "0")}`
            : "Venue -"}
        </span>
        {/* R6 § M.13: stopPropagation on pointerdown prevents dnd-kit's
            PointerSensor from interpreting the chevron click as the start
            of a drag (the activation constraint distance: 5 still risks
            firing on a slow trackpad). */}
        <button
          type="button"
          onClick={onMoveUp}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!canMoveUp}
          title="Move up"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!canMoveDown}
          title="Move down"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Row 2: editable venue name, full-width. Amendment v2 § 1:
          dropped the flex-row layout; name takes its own row, type
          popover moves to Row 3 below. */}
      <div className="mb-3">
        <input
          value={v.name}
          onChange={(e) => onSave({ name: e.target.value })}
          className="w-full [field-sizing:content] bg-transparent border border-transparent rounded px-2 py-1 text-2xl font-black uppercase tracking-tight hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors"
        />
      </div>

      {/* Row 3: TypeTogglePopover stacked below the name input,
          left-aligned. Amendment v2 § 1 lock. */}
      <div className="mb-4">
        <TypeTogglePopover
          currentTypes={types}
          direction="horizontal"
          onChange={(next) =>
            onSave({ venue_type: next.join(" / ") || null })
          }
        />
      </div>

      {/* Body: 2-column layout (LEFT fields stacked, RIGHT 4-photo
          grid) per the post-smoke polish call. Mirrors today's
          FinalReview shape so the photo tiles get full half-card
          width. Type moved into the top-bar row above; LEFT field
          order: Address, (Neighborhood / Size / Capacity), Website,
          Overview, Notes/Feedback. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-7 pt-3 pb-3">
        {/* LEFT: fields stack */}
        <div className="space-y-4">
          <CardField label="Address">
            <input
              value={v.address ?? ""}
              onChange={(e) => onSave({ address: e.target.value })}
              className={inputCls}
            />
          </CardField>

          {/* Neighborhood / Size / Capacity on one row at 40/30/30 */}
          <div className="grid grid-cols-[4fr_3fr_3fr] gap-4">
            <CardField label="Neighborhood">
              {/* min-h-[28px] matches the sibling Size + Capacity
                  inputs' outer height (text-sm + py-1 + leading-snug);
                  flex items-center vertically centers the
                  combobox-trigger button (15px font, no native
                  padding) inside that same height so the text
                  baseline lines up with the sibling inputs in this
                  row. px-2 mirrors the inputs' horizontal padding so
                  the trigger label's left edge aligns with the
                  inputs' text left edge. */}
              <div className="flex items-center px-2 min-h-[28px]">
                <RecordCombobox
                  source={{
                    kind: "lookup",
                    table: "neighborhoods",
                    parentScopeId: scoutCityId,
                    parentScopeLabel: scoutCity,
                    parentScopeLabelKey: "City",
                  }}
                  value={v.neighborhood || null}
                  onChange={(next) => onSave({ neighborhood: next || null })}
                  entityLabel="neighborhood"
                  placeholder={
                    scoutCityId ? "Select" : "Pick a scout city first"
                  }
                  disabled={!scoutCityId}
                />
              </div>
            </CardField>
            <CardField label="Size">
              <input
                value={display.size ?? ""}
                onChange={(e) => onSaveSize(e.target.value)}
                className={rowInputCls}
                placeholder="e.g. 25,000 sq ft"
              />
            </CardField>
            <CardField label="Capacity">
              <input
                value={display.capacity ?? ""}
                onChange={(e) => onSaveCapacity(e.target.value)}
                className={rowInputCls}
                placeholder="e.g. ~500 or TBD"
              />
            </CardField>
          </div>

          <CardField label="Website">
            <div className="flex items-center gap-1">
              <input
                value={v.website_url ?? ""}
                onChange={(e) =>
                  onSave({ website_url: e.target.value || null })
                }
                className={inputCls}
                placeholder="https://"
              />
              {v.website_url ? (
                <a
                  href={v.website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-primary hover:bg-input"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </CardField>

          {/* R6 § I.2 + § I.3: label renamed "Overview" → "Venue Overview"
              and the Regenerate Overview affordance moved inline with the
              label as a coral text link (matching BriefReport's Overview
              card-headbar pattern), replacing the Notes/Feedback row's
              outline-button placement. */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="label-form">Venue Overview</div>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                disabled={regenerating}
                onClick={() => onRegenerate()}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
            <textarea
              rows={10}
              value={v.venue_overview ?? ""}
              onChange={(e) => onSave({ venue_overview: e.target.value })}
              placeholder="Populated after compile."
              className={inputCls + " resize-y"}
            />
          </div>

          {/* Notes / Feedback. R6 § M.7: textarea switched from
              uncontrolled (defaultValue) to controlled (value + onChange)
              so parent-side updates to v.notes are reflected without a
              remount key. */}
          <div>
            <div className="flex items-center mb-1.5">
              <div className="label-form">Notes / Feedback</div>
            </div>
            <textarea
              className="w-full min-h-[60px] bg-input border border-transparent rounded px-2 py-1.5 text-sm leading-snug text-foreground placeholder:text-primary focus:border-primary focus:outline-none transition-colors resize-y"
              placeholder="Notes feed the overview when you Regenerate. Never appears on the deck."
              value={v.notes ?? ""}
              onChange={(e) => onSave({ notes: e.target.value || null })}
            />
          </div>
        </div>

        {/* RIGHT: 4-photo grid (FinalReview sizing; the column now
            spans a full half of the card width). Photo-count meta
            sits below the grid, anchored bottom-right. */}
        <div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <PhotoSlot
                key={i}
                hasPhoto={!!photoUrls[i]}
                photoUrl={photoUrls[i] ?? null}
                onClick={onOpenPhotos}
              />
            ))}
          </div>
          <div className="mt-3 text-right">
            <PhotoMeta count={photoCount} />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}

function PhotoMeta({ count }: { count: number }) {
  if (count >= 4) {
    return (
      <div className="text-xs text-green-400">
        ✓ <strong className="text-foreground">4 / 4</strong> photos uploaded
      </div>
    );
  }
  if (count > 0) {
    return (
      <div className="text-xs text-primary">
        ⊕ <strong className="text-foreground">{count} / 4</strong> photos
        uploaded · {4 - count} more needed
      </div>
    );
  }
  return (
    <div className="text-xs text-primary">
      ⊕ <strong className="text-foreground">0 / 4</strong> photos uploaded
    </div>
  );
}

function PhotoSlot({
  hasPhoto,
  photoUrl,
  onClick,
}: {
  hasPhoto: boolean;
  photoUrl: string | null;
  onClick: () => void;
}) {
  const bgImage =
    hasPhoto && photoUrl ? `url(${photoUrl})` : "url(/mirror-placeholder.jpg)";
  return (
    <button
      onClick={onClick}
      className="aspect-square rounded-md bg-input border border-border hover:border-primary transition-colors flex items-center justify-center bg-cover bg-center group"
      style={{ backgroundImage: bgImage }}
    >
      {!hasPhoto && (
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary bg-background/80 px-2 py-1 rounded">
          + Upload
        </span>
      )}
    </button>
  );
}
