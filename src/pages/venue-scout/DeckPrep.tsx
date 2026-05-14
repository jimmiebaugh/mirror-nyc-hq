// Phase 4.8.1-port: Deck Prep. Lifted from VS Pro
// (mirror-nyc-venue-scout-pro src/pages/sourcing/DeckPrep.tsx, 427 lines)
// with HQ token swaps + column renames:
//   projects -> vs_scouts
//   venues -> vs_candidate_venues
//   venue_photos -> vs_venue_photos
//   venue_id (on photos) -> candidate_venue_id
//   getPublicUrl() -> createSignedUrl(path, 3600)
//   max-w-[1500px] -> max-w-7xl (AppShell parent)
//   PageHeader -> inline header (4.2-4.7.1 precedent)
//
// Generate Deck navigates to /deck/generating which 404s until 4.8.2-port.
// vs-generate-deck invocation + error routing also land in 4.8.2-port.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, GripVertical, Plus } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PhotoUploadModal } from "@/components/venue-scout/PhotoUploadModal";
import {
  EditableField,
  EditableTextarea,
} from "@/components/venue-scout/matrix/primitives";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";

type Venue = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  size_sq_ft: number | null;
  capacity: number | null;
  website_url: string | null;
  venue_overview: string | null;
};
// Phase 4.10.2-port: shared patch shape for the inline-edit save on this
// page. Kept at module scope (rather than inside the component) so DeckRow
// can reference it via the `onSave` prop type without re-declaring.
type FieldPatch = {
  name?: string;
  address?: string | null;
  neighborhood?: string | null;
  size_sq_ft?: number | null;
  capacity?: number | null;
  website_url?: string | null;
  venue_overview?: string | null;
};
type Photo = { candidate_venue_id: string; slot: number; storage_path: string };

// Mirror's deck template has 6 front-matter slides (cover, project info
// across slides 2-3, event overview, section title, venue map / legend)
// plus 2 per-venue slides (detail + floor plan). Bumped from 5 to 6 in
// 4.8.3-port after first real producer test verified the template count.
const FRONT_MATTER_SLIDES = 6;
const PER_VENUE_SLIDES = 2;

export default function DeckPrep() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [photosByVenue, setPhotosByVenue] = useState<Record<string, Photo[]>>({});
  // venueId -> slot -> signed URL (1-hour TTL via createSignedUrl). Lookup
  // keyed by raw slot value, including the TEMP=-1 slot during a swap.
  const [photoUrlsByVenue, setPhotoUrlsByVenue] = useState<
    Record<string, Record<number, string>>
  >({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // Phase 4.9-port: meta for <ScoutStepThroughNav />. Extends the existing
  // deck_order fetch to also pull current_step + generated_decks.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; generated_decks: unknown } | null
  >(null);
  const [photoModal, setPhotoModal] = useState<
    { venueId: string; venueName: string } | null
  >(null);
  const orderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 4.10.2-port: per-venue 600ms debounce for inline edits on the
  // venue summary cell (name / address / neighborhood / size / cap /
  // website) + the venue_overview cell. Same shape as Shortlist + the
  // new SourcingReport debounceSave.
  const fieldTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const reviewPath = `/venue-scout/scouts/${scoutId}/sourcing/review`;

  const buildPhotoUrlMap = useCallback(
    async (photos: Photo[]): Promise<Record<string, Record<number, string>>> => {
      const out: Record<string, Record<number, string>> = {};
      if (!photos.length) return out;
      const signed = await Promise.all(
        photos.map((p) =>
          supabase.storage
            .from("vs_venue_photos")
            .createSignedUrl(p.storage_path, 3600),
        ),
      );
      photos.forEach((p, i) => {
        const url = signed[i]?.data?.signedUrl;
        if (!url) return;
        if (!out[p.candidate_venue_id]) out[p.candidate_venue_id] = {};
        out[p.candidate_venue_id][p.slot] = url;
      });
      return out;
    },
    [],
  );

  const load = useCallback(async () => {
    if (!scoutId) return;
    const { data: scout } = await supabase
      .from("vs_scouts")
      .select("deck_order, current_step, generated_decks")
      .eq("id", scoutId)
      .maybeSingle();
    const savedOrder = ((scout?.deck_order as unknown) ?? []) as string[];
    setScoutMeta(
      scout
        ? {
            current_step: (scout.current_step as string | null) ?? null,
            generated_decks: scout.generated_decks,
          }
        : null,
    );

    const { data: vs } = await supabase
      .from("vs_candidate_venues")
      .select(
        "id, name, address, neighborhood, size_sq_ft, capacity, website_url, venue_overview",
      )
      .eq("scout_id", scoutId)
      .eq("pitched", true);
    const list = ((vs ?? []) as unknown) as Venue[];

    // Sort venues per saved deck_order. Unknown ids (newly-pitched venues
    // added since the last persisted order) anchor at the end, preserving
    // their natural sort order.
    const ordered = [...list].sort((a, b) => {
      const ai = savedOrder.indexOf(a.id);
      const bi = savedOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    setVenues(ordered);
    setIncluded(Object.fromEntries(ordered.map((v) => [v.id, true])));

    if (ordered.length) {
      const ids = ordered.map((v) => v.id);
      const { data: ph } = await supabase
        .from("vs_venue_photos")
        .select("candidate_venue_id, slot, storage_path")
        .in("candidate_venue_id", ids);
      const rows = ((ph ?? []) as unknown) as Photo[];
      const map: Record<string, Photo[]> = {};
      rows.forEach((p) => {
        (map[p.candidate_venue_id] ||= []).push(p);
      });
      Object.values(map).forEach((arr) => arr.sort((a, b) => a.slot - b.slot));
      setPhotosByVenue(map);
      const urls = await buildPhotoUrlMap(rows);
      setPhotoUrlsByVenue(urls);
    } else {
      setPhotosByVenue({});
      setPhotoUrlsByVenue({});
    }
    setLoading(false);
  }, [scoutId, buildPhotoUrlMap]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (orderTimer.current) clearTimeout(orderTimer.current);
      // Phase 4.10.2-port: drop any pending inline-edit timers on unmount
      // (producer navigates away before the 600ms debounce fires). Mirrors
      // SourcingReport + Shortlist cleanup behavior.
      Object.values(fieldTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Phase 4.10.2-port: inline-edit save for the DeckPrep venue summary +
  // overview cells. Optimistic state update, then 600ms debounced UPDATE.
  // Patch fields are coerced (numbers, null-on-empty) at the call site so
  // the in-memory Venue keeps its typed shape. `website_url` validation
  // deferred to 4.10.3-port (URL hot patch).
  function debounceSave(id: string, patch: FieldPatch) {
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? ({ ...v, ...patch } as Venue) : v)),
    );
    clearTimeout(fieldTimers.current[id]);
    fieldTimers.current[id] = setTimeout(async () => {
      const { error } = await supabase
        .from("vs_candidate_venues")
        .update(patch)
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        load();
      }
    }, 600);
  }
  // Helper: parse a raw string ("25,000 sq ft" / "1500") into an int or
  // null. Strips non-digit characters so producers can type with units.
  function parseIntOrNull(raw: string): number | null {
    const cleaned = raw.replace(/[^\d]/g, "");
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  }

  function persistOrder(next: Venue[]) {
    if (!scoutId) return;
    if (orderTimer.current) clearTimeout(orderTimer.current);
    orderTimer.current = setTimeout(async () => {
      await supabase
        .from("vs_scouts")
        .update({ deck_order: next.map((v) => v.id) })
        .eq("id", scoutId);
    }, 500);
  }

  function onRowDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setVenues((prev) => {
      const oldIdx = prev.findIndex((v) => v.id === active.id);
      const newIdx = prev.findIndex((v) => v.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      persistOrder(next);
      return next;
    });
  }

  async function swapPhotoSlots(
    venueId: string,
    fromSlot: number,
    toSlot: number,
  ) {
    if (fromSlot === toSlot) return;
    const photos = photosByVenue[venueId] ?? [];
    const from = photos.find((p) => p.slot === fromSlot);
    const to = photos.find((p) => p.slot === toSlot);
    if (!from) return;

    // Optimistic local state.
    setPhotosByVenue((prev) => {
      const next = { ...prev };
      next[venueId] = (next[venueId] ?? [])
        .map((p) => {
          if (p.slot === fromSlot) return { ...p, slot: toSlot };
          if (p.slot === toSlot) return { ...p, slot: fromSlot };
          return p;
        })
        .sort((a, b) => a.slot - b.slot);
      return next;
    });
    // Mirror in the signed-URL map so thumbnails follow without a reload.
    setPhotoUrlsByVenue((prev) => {
      const venueMap = { ...(prev[venueId] ?? {}) };
      const fromUrl = venueMap[fromSlot];
      const toUrl = venueMap[toSlot];
      if (fromUrl !== undefined) venueMap[toSlot] = fromUrl;
      else delete venueMap[toSlot];
      if (toUrl !== undefined) venueMap[fromSlot] = toUrl;
      else delete venueMap[fromSlot];
      return { ...prev, [venueId]: venueMap };
    });

    // Persist: use a temp slot to avoid UNIQUE conflicts on
    // (candidate_venue_id, slot). 3-step shuffle when both slots populated;
    // 1-step when only the from slot has a photo. Lifted verbatim from VS Pro
    // with column rename venue_id -> candidate_venue_id.
    const TEMP = -1;
    if (to) {
      await supabase
        .from("vs_venue_photos")
        .update({ slot: TEMP })
        .eq("candidate_venue_id", venueId)
        .eq("slot", fromSlot);
      await supabase
        .from("vs_venue_photos")
        .update({ slot: fromSlot })
        .eq("candidate_venue_id", venueId)
        .eq("slot", toSlot);
      await supabase
        .from("vs_venue_photos")
        .update({ slot: toSlot })
        .eq("candidate_venue_id", venueId)
        .eq("slot", TEMP);
    } else {
      await supabase
        .from("vs_venue_photos")
        .update({ slot: toSlot })
        .eq("candidate_venue_id", venueId)
        .eq("slot", fromSlot);
    }
  }

  async function reloadVenuePhotos(venueId: string) {
    const { data: ph } = await supabase
      .from("vs_venue_photos")
      .select("candidate_venue_id, slot, storage_path")
      .eq("candidate_venue_id", venueId)
      .order("slot");
    const rows = ((ph ?? []) as unknown) as Photo[];
    setPhotosByVenue((prev) => ({ ...prev, [venueId]: rows }));
    const urls = await buildPhotoUrlMap(rows);
    setPhotoUrlsByVenue((prev) => ({
      ...prev,
      [venueId]: urls[venueId] ?? {},
    }));
  }

  const includedVenues = useMemo(
    () => venues.filter((v) => included[v.id]),
    [venues, included],
  );
  const totalSlides =
    FRONT_MATTER_SLIDES + includedVenues.length * PER_VENUE_SLIDES;

  async function generate() {
    if (generating || includedVenues.length === 0 || !scoutId) return;
    setGenerating(true);
    // Cancel any pending debounced order write so the explicit
    // deck_order persist below is the last writer. Avoids an orphan
    // setTimeout firing against an unmounted component after navigate.
    if (orderTimer.current) {
      clearTimeout(orderTimer.current);
      orderTimer.current = null;
    }

    // Phase 4.10.6-port: reset scout state for a clean regenerate.
    //
    // When the scout has already been through a successful generate
    // cycle, current_step='completed' and brief_data.deck_generation_started_at
    // holds the prior kickoff timestamp. Both gate vs-generate-deck from
    // running again:
    //   - if (scout.current_step !== "deck_prep") return skipped
    //   - if (deck_generation_started_at < grace window) return in_flight
    // Without a reset here, clicking Generate again silently no-ops and
    // Generating.tsx sees the unchanged success state, treating the
    // prior deck as a fresh result.
    //
    // Uses the reset_scout_for_deck_regenerate RPC (migration
    // 20260514100000) so the brief_data jsonb minus is atomic in a
    // single SQL statement -- no TOCTOU window between a read and a
    // write. The RPC sets current_step='deck_prep', strips
    // deck_generation_started_at via jsonb `-` operator, and resets
    // status + pipeline_error. deck_order is persisted in a separate
    // UPDATE since it isn't part of the reset semantics.
    await supabase.rpc("reset_scout_for_deck_regenerate", {
      target_scout_id: scoutId,
    });
    await supabase
      .from("vs_scouts")
      .update({ deck_order: venues.map((v) => v.id) })
      .eq("id", scoutId);

    // Mark each venue's include_in_deck flag to match the current UI
    // selection so vs-generate-deck only generates what the producer
    // expects.
    await Promise.all(
      venues.map((v) =>
        supabase
          .from("vs_candidate_venues")
          .update({ include_in_deck: !!included[v.id] })
          .eq("id", v.id),
      ),
    );
    // 4.8.1-port: navigate to the 404 window. 4.8.2-port closes it with the
    // Generating page + vs-generate-deck edge function.
    nav(`/venue-scout/scouts/${scoutId}/deck/generating`);
  }

  if (loading) {
    return <div className="p-12 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        <Link to={reviewPath} className="crumb">
          ← Review Selects
        </Link>
        <div className="flex items-end justify-between gap-5">
          <div className="space-y-2">
            <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
              Deck
            </div>
            <h1 className="h-page">Deck Prep</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Final review before generating. Drag rows to set venue order, top
              to bottom = Venue 01, 02, 03, etc. Drag photos within a row to set
              their slot position on the deck slide.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <Link
              to={reviewPath}
              className="text-[13px] font-mono uppercase tracking-wider text-primary hover:underline"
            >
              ← Back to Review
            </Link>
            {scoutId && <ScoutSettingsLink scoutId={scoutId} />}
          </div>
        </div>
      </header>
      {scoutId && <ScoutStepThroughNav scoutId={scoutId} scout={scoutMeta} />}

      <div className="text-right text-xs text-muted-foreground mb-3">
        <strong className="text-foreground">{includedVenues.length}</strong>{" "}
        venues included
        <span className="mx-2">·</span>
        <strong className="text-foreground">{totalSlides} total slides</strong>
        <span className="text-muted-foreground/70">
          {" "}
          ({FRONT_MATTER_SLIDES} front-matter + 2 per venue)
        </span>
      </div>

      {/* Phase 4.10.4-port: notes consolidated above the table in a single
          bulleted card. Copy preserved verbatim from the 4.8.1-port
          asterisk-list block that used to live below the table. Card uses
          bg-input + white (foreground) text + coral bullet markers per
          Jimmie's lock 2026-05-13. */}
      <div className="mb-4 rounded-md border border-border bg-input px-4 py-3">
        <ul className="text-sm text-foreground space-y-1 list-disc list-inside marker:text-primary">
          <li>Drag rows to reorder · top = Venue 01</li>
          <li>
            Drag photos within a row to swap slot positions (TL · TR · BL · BR)
          </li>
          <li>
            Cover, project info, event overview, section title, venue map
            slides auto-generate from brief
          </li>
          <li>One detail + one floor plan slide per venue</li>
        </ul>
      </div>

      <div className="bg-surface-alt rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[40px_90px_70px_minmax(220px,1fr)_minmax(280px,360px)_minmax(280px,2fr)] gap-0 border-b border-border bg-input text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <div className="px-3 py-3 text-center">≡</div>
          <div className="px-3 py-3">Order</div>
          <div className="px-3 py-3 text-center">Include</div>
          <div className="px-3 py-3">Venue</div>
          <div className="px-3 py-3">Photos for Deck</div>
          <div className="px-3 py-3">Generated Summary</div>
        </div>

        {venues.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No pitched venues.{" "}
            <Link to={reviewPath} className="text-primary underline">
              Go back to Review
            </Link>
            .
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onRowDragEnd}
          >
            <SortableContext
              items={venues.map((v) => v.id)}
              strategy={verticalListSortingStrategy}
            >
              {venues.map((v, idx) => (
                <DeckRow
                  key={v.id}
                  venue={v}
                  orderNum={idx + 1}
                  included={!!included[v.id]}
                  onToggle={(next) =>
                    setIncluded((prev) => ({ ...prev, [v.id]: next }))
                  }
                  photos={photosByVenue[v.id] ?? []}
                  photoUrls={photoUrlsByVenue[v.id] ?? {}}
                  onSwapPhotos={(from, to) => swapPhotoSlots(v.id, from, to)}
                  onOpenPhotos={() =>
                    setPhotoModal({ venueId: v.id, venueName: v.name })
                  }
                  onSave={(patch) => debounceSave(v.id, patch)}
                  parseIntOrNull={parseIntOrNull}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Phase 4.10.4-port: the below-table ✱ asterisk-note block has moved
          above the table (see the card just above the matrix). The notes are
          identical to the prior copy; consolidated into a single bulleted
          card per Jimmie's lock 2026-05-13 so the producer sees them first
          rather than below the matrix scroll. */}

      {/* Phase 4.10.4-port: bottom-nav rework.
          - "X slides will be generated" dropped (the table header already
            shows total slide count).
          - "X Venues" bumped to text-xl semibold to match the count emphasis
            on the rest of the page.
          - Bulleted list of each included venue name underneath the count,
            in the same pitched / order sequence the deck will use. Internal
            scroll (max-h-40) caps the floating-nav footprint when a scout
            pitches many venues; the producer can scroll within the nav
            without the whole bar growing. */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to={reviewPath} className="crumb">
            ← Back
          </Link>
          <div className="flex flex-col gap-1 max-w-md">
            <p className="text-xl font-semibold text-foreground">
              {includedVenues.length}{" "}
              {includedVenues.length === 1 ? "Venue" : "Venues"}
            </p>
            {includedVenues.length > 0 ? (
              <ul className="text-sm text-muted-foreground space-y-0.5 list-disc list-inside marker:text-primary max-h-40 overflow-y-auto">
                {includedVenues.map((v) => (
                  <li key={v.id} className="leading-snug">
                    {v.name || "(untitled)"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button
            onClick={generate}
            disabled={generating || includedVenues.length === 0}
          >
            {generating ? "Generating…" : "Generate Deck →"}
          </Button>
        </div>
      </div>

      <PhotoUploadModal
        open={!!photoModal}
        onOpenChange={(o) => {
          if (!o) setPhotoModal(null);
        }}
        scoutId={scoutId ?? ""}
        venueId={photoModal?.venueId ?? null}
        venueName={photoModal?.venueName ?? ""}
        onSaved={() => {
          if (photoModal) {
            void reloadVenuePhotos(photoModal.venueId);
          }
        }}
      />
    </div>
  );
}

function DeckRow({
  venue,
  orderNum,
  included,
  onToggle,
  photos,
  photoUrls,
  onSwapPhotos,
  onOpenPhotos,
  onSave,
  parseIntOrNull,
}: {
  venue: Venue;
  orderNum: number;
  included: boolean;
  onToggle: (next: boolean) => void;
  photos: Photo[];
  photoUrls: Record<number, string>;
  onSwapPhotos: (fromSlot: number, toSlot: number) => void;
  onOpenPhotos: () => void;
  // Phase 4.10.2-port: debounced inline-edit callback. Already partial-applied
  // with this row's venue id; DeckRow just builds the patch.
  onSave: (patch: FieldPatch) => void;
  parseIntOrNull: (raw: string) => number | null;
}) {
  const sortable = useSortable({ id: venue.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  const sizeDisplay =
    venue.size_sq_ft != null ? `${venue.size_sq_ft.toLocaleString()} sq ft` : "";
  const capacityDisplay = venue.capacity != null ? `${venue.capacity}` : "";
  // Phase 4.10.4-port: when all three meta fields (neighborhood / size /
  // capacity) are null/empty, skip the stack entirely so the cell doesn't
  // render an empty flex container that still occupies the parent's gap.
  // Producer would normally fill these on Review before reaching DeckPrep;
  // showing a "(no details)" placeholder would be misleading.
  const hasAnyMeta =
    (venue.neighborhood ?? "").trim().length > 0 ||
    sizeDisplay.length > 0 ||
    capacityDisplay.length > 0;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      data-included={included ? "true" : "false"}
      className={`grid grid-cols-[40px_90px_70px_minmax(220px,1fr)_minmax(280px,360px)_minmax(280px,2fr)] gap-0 border-b border-border last:border-b-0 transition-opacity ${included ? "" : "opacity-60"}`}
    >
      <div className="px-3 py-5 flex items-start justify-center">
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="px-3 py-5">
        <span
          className={`inline-block px-2 py-1 rounded text-[10px] font-bold uppercase tracking-[0.14em] ${
            included
              ? "bg-primary text-primary-foreground"
              : "bg-input text-muted-foreground"
          }`}
        >
          {included ? `Venue ${String(orderNum).padStart(2, "0")}` : "Venue -"}
        </span>
      </div>
      <div className="px-3 py-5 flex items-start justify-center">
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-[18px] w-[18px] accent-primary cursor-pointer"
        />
      </div>
      {/*
        Phase 4.10.2-port: editable venue summary stack. Before: static name +
        meta line. After: editable name, NEW editable address row, editable
        neighborhood + size + capacity inline (size + cap parse to int with
        unit suffix tolerated), editable website_url (external-link icon
        kept). All saves go through onSave -> debounceSave (600ms).
      */}
      <div className="px-3 py-5 space-y-1.5">
        <EditableField
          id={`${venue.id}-name-deck`}
          value={venue.name}
          onChange={(n) => onSave({ name: n })}
          variant="name"
          placeholder="(untitled)"
        />
        <EditableField
          id={`${venue.id}-addr-deck`}
          value={venue.address ?? ""}
          onChange={(a) => onSave({ address: a.trim() || null })}
          variant="address"
          placeholder="(no address)"
        />
        {/* Phase 4.10.4-port: neighborhood / size / capacity stacked
            vertically. Each row gets its own line with a "Field:" label so
            the producer can scan the cell without parsing inline separators.
            Skip a row entirely when the underlying value is null/empty
            (don't render an empty "Neighborhood:" line). The fields remain
            inline-editable; the visual change is layout-only.

            When all three fields are empty, skip the stack container too so
            the cell doesn't render a zero-height flex element that still
            consumes the parent's gap-y. */}
        {hasAnyMeta ? (
          <div className="flex flex-col gap-y-0.5 text-[11.5px] text-muted-foreground">
            {(venue.neighborhood ?? "").trim().length > 0 ? (
              <div className="flex items-baseline gap-x-1">
                <span aria-hidden className="text-muted-foreground/70">
                  Neighborhood:
                </span>
                <EditableField
                  id={`${venue.id}-neigh-deck`}
                  value={venue.neighborhood ?? ""}
                  onChange={(n) =>
                    onSave({ neighborhood: n.trim() || null })
                  }
                  variant="neighborhood"
                  placeholder="(neighborhood)"
                />
              </div>
            ) : null}
            {sizeDisplay.length > 0 ? (
              <div className="flex items-baseline gap-x-1">
                <span aria-hidden className="text-muted-foreground/70">
                  Size:
                </span>
                <EditableField
                  id={`${venue.id}-size-deck`}
                  value={sizeDisplay}
                  onChange={(raw) =>
                    onSave({ size_sq_ft: parseIntOrNull(raw) })
                  }
                  variant="neighborhood"
                  placeholder="(sq ft)"
                />
              </div>
            ) : null}
            {capacityDisplay.length > 0 ? (
              <div className="flex items-baseline gap-x-1">
                <span aria-hidden className="text-muted-foreground/70">
                  Capacity:
                </span>
                <EditableField
                  id={`${venue.id}-cap-deck`}
                  value={capacityDisplay}
                  onChange={(raw) =>
                    onSave({ capacity: parseIntOrNull(raw) })
                  }
                  variant="neighborhood"
                  placeholder="(cap)"
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <EditableField
            id={`${venue.id}-url-deck`}
            value={venue.website_url ?? ""}
            onChange={(u) => onSave({ website_url: u.trim() || null })}
            variant="address"
            placeholder="(no website)"
          />
          {venue.website_url ? (
            <a
              href={venue.website_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary"
              title="Open website"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-5">
        <PhotoSlotRow
          venueId={venue.id}
          photos={photos}
          photoUrls={photoUrls}
          onSwap={onSwapPhotos}
          onOpen={onOpenPhotos}
        />
      </div>
      {/*
        Phase 4.10.2-port: editable overview via <EditableTextarea>. Replaces
        the read-only render of venue_overview. The textarea is uncontrolled
        (defaultValue keyed on venue.id) so optimistic state updates from
        debounceSave don't fight the producer's caret.
      */}
      <div className="px-3 py-5">
        <EditableTextarea
          id={`${venue.id}-overview-deck`}
          value={venue.venue_overview ?? ""}
          onChange={(t) => onSave({ venue_overview: t })}
          placeholder="Summary will appear after compile."
          rows={6}
        />
      </div>
    </div>
  );
}

function PhotoSlotRow({
  venueId,
  photos,
  photoUrls,
  onSwap,
  onOpen,
}: {
  venueId: string;
  photos: Photo[];
  photoUrls: Record<number, string>;
  onSwap: (fromSlot: number, toSlot: number) => void;
  onOpen: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = parseInt(
      String(active.id).replace(`${venueId}-slot-`, ""),
      10,
    );
    const to = parseInt(String(over.id).replace(`${venueId}-slot-`, ""), 10);
    if (!isNaN(from) && !isNaN(to)) onSwap(from, to);
  }

  const slotIds = [1, 2, 3, 4].map((n) => `${venueId}-slot-${n}`);

  // Post-4.10.4 hot patch round 17: switched strategy from
  // verticalListSortingStrategy to rectSortingStrategy. The slots are
  // laid out in a `grid grid-cols-4` (horizontal row, or 2x2 grid on
  // narrow widths), not a vertical list. verticalListSortingStrategy
  // computes the shift animation for vertical-only motion, so dragging
  // a photo sideways gave no visual feedback and the drop hit zones
  // felt broken. rectSortingStrategy handles arbitrary grid arrangements
  // and animates neighbors in whichever direction the drag is heading.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={slotIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((slotNum) => {
            const photo = photos.find((p) => p.slot === slotNum);
            const url = photoUrls[slotNum];
            return (
              <PhotoSlot
                key={slotNum}
                id={`${venueId}-slot-${slotNum}`}
                photo={photo}
                photoUrl={url}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function PhotoSlot({
  id,
  photo,
  photoUrl,
  onOpen,
}: {
  id: string;
  photo: Photo | undefined;
  photoUrl: string | undefined;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !photo });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  if (photo && photoUrl) {
    return (
      <div
        ref={setNodeRef}
        style={{ ...style, backgroundImage: `url(${photoUrl})` }}
        {...attributes}
        {...listeners}
        onClick={onOpen}
        className="aspect-square rounded border border-border bg-cover bg-center cursor-pointer hover:border-primary"
        title="Click to manage photos · drag to swap slot"
      />
    );
  }
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      onClick={onOpen}
      className="aspect-square rounded border border-dashed border-border bg-input flex items-center justify-center text-muted-foreground/60 hover:border-primary hover:text-primary cursor-pointer"
      title="Click to upload photos"
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}
