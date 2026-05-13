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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PhotoUploadModal } from "@/components/venue-scout/PhotoUploadModal";

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
  const [photoModal, setPhotoModal] = useState<
    { venueId: string; venueName: string } | null
  >(null);
  const orderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      .select("deck_order")
      .eq("id", scoutId)
      .maybeSingle();
    const savedOrder = ((scout?.deck_order as unknown) ?? []) as string[];

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
    };
  }, []);

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
    // Persist any pending order, then mark each venue's include_in_deck flag
    // to match the current UI selection so vs-generate-deck only generates
    // what the producer expects.
    await supabase
      .from("vs_scouts")
      .update({ deck_order: venues.map((v) => v.id) })
      .eq("id", scoutId);
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
          <Link
            to={reviewPath}
            className="text-[13px] font-mono uppercase tracking-wider text-primary hover:underline"
          >
            ← Back to Review
          </Link>
        </div>
      </header>

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
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.12em]">
        <span className="px-3 py-1.5 rounded bg-input border border-border text-amber-400">
          ✱ Drag rows to reorder · top = Venue 01
        </span>
        <span className="px-3 py-1.5 rounded bg-input border border-border text-amber-400">
          ✱ Drag photos within a row to swap slot positions (TL · TR · BL · BR)
        </span>
        <span className="px-3 py-1.5 rounded bg-input border border-border text-amber-400">
          ✱ Cover, project info, event overview, section title, venue map slides
          auto-generate from brief
        </span>
        <span className="px-3 py-1.5 rounded bg-input border border-border text-amber-400">
          ✱ One detail + one floor plan slide per venue
        </span>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to={reviewPath} className="crumb">
            ← Back
          </Link>
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">{includedVenues.length}</strong>{" "}
            venues
            <span className="mx-2">·</span>
            <strong className="text-foreground">{totalSlides} slides</strong>{" "}
            will be generated
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
}: {
  venue: Venue;
  orderNum: number;
  included: boolean;
  onToggle: (next: boolean) => void;
  photos: Photo[];
  photoUrls: Record<number, string>;
  onSwapPhotos: (fromSlot: number, toSlot: number) => void;
  onOpenPhotos: () => void;
}) {
  const sortable = useSortable({ id: venue.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  const meta = [
    venue.neighborhood,
    venue.size_sq_ft != null
      ? `${venue.size_sq_ft.toLocaleString()} sq ft`
      : null,
    venue.capacity != null ? `~${venue.capacity} cap` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
      <div className="px-3 py-5">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[15px]">
            {venue.name || "(untitled)"}
          </span>
          {venue.website_url && (
            <a
              href={venue.website_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="text-[11.5px] text-muted-foreground mt-1.5 leading-snug">
          {meta || "-"}
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
      <div className="px-3 py-5 text-[12.5px] leading-relaxed text-foreground/90">
        {venue.venue_overview ? (
          venue.venue_overview
        ) : (
          <span className="text-muted-foreground italic">
            Summary will appear after compile.
          </span>
        )}
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={slotIds} strategy={verticalListSortingStrategy}>
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
