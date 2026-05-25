// Phase 5.12.15: consolidated Review surface.
//
// Absorbs today's Final Review (the `review_selects` page) AND today's
// Deck Prep (the `deck_prep` page) into one surface. The file was
// renamed from DeckPrep.tsx; the 618-line Final Review file was
// deleted at squash time. Route segment collapses to /review.
//
// The `current_step='deck_prep'` enum stays unchanged: the state
// machine + the CAS guards on vs-compile-summaries
// (`.eq("current_step", "compiling")`) and vs-generate-deck
// (`.eq("current_step", "deck_prep")`) are byte-untouched. The
// `review_selects` enum value persists in the DB for legacy scouts;
// stepToRoute("review_selects") routes forward to /review (no
// backfill migration).
//
// Producer flow: Shortlist Continue flips current_step directly to
// 'compiling' (skips the standalone Final Review step) -> Compiling
// runs Pass 2 -> success lands here at current_step='deck_prep'.
//
// Per-card body lives in the new ReviewCard sibling
// (src/components/venue-scout/ReviewCard.tsx) so the parent stays
// at ~600-700 lines and the card chrome is one localized edit point
// for 5.12.14's VS UX/style sweep. This parent owns the loader,
// DndContext, state hooks, debounceSave + flushPendingFieldSaves
// machinery, the regenerate handler that invokes the new
// vs-regenerate-venue-overview edge function, the Generate Deck
// modal + flow, and the sticky bottom nav.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { PhotoUploadModal } from "@/components/venue-scout/PhotoUploadModal";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";
import { useCityIdForName } from "@/lib/hq/lookups";
import { ReviewCard } from "@/components/venue-scout/ReviewCard";

type Venue = {
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

// Display strings for size/capacity that allow free-form input
// (commas, "TBD", "~500") between keystroke and debounced parse.
type Display = { size?: string; capacity?: string };

type FieldPatch = {
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

// Mirror's deck template has 6 front-matter slides (cover, project
// info across slides 2-3, event overview, section title, venue map /
// legend) plus 2 per-venue slides (detail + floor plan). Producer-
// facing copy reads "front-end" per Jimmie's 5.12.15 call; the
// constant name stays internal.
const FRONT_MATTER_SLIDES = 6;
const PER_VENUE_SLIDES = 2;

export default function Review() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [photoUrls, setPhotoUrls] = useState<
    Record<string, (string | null)[]>
  >({});
  const [display, setDisplay] = useState<Record<string, Display>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; city: string | null } | null
  >(null);
  const [photoModal, setPhotoModal] = useState<
    { venueId: string; venueName: string } | null
  >(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const orderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Cumulative pending patch per venue, merged across successive
  // debounced edits so a name keystroke followed by an overview
  // keystroke flushes BOTH fields. flushPendingFieldSaves reads this
  // map and runs the UPDATEs immediately on Generate Deck.
  const pendingFieldPatches = useRef<Record<string, FieldPatch>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const load = useCallback(async () => {
    if (!scoutId) return;
    const { data: scout } = await supabase
      .from("vs_scouts")
      .select("deck_order, current_step, city")
      .eq("id", scoutId)
      .maybeSingle();
    const savedOrder = ((scout?.deck_order as unknown) ?? []) as string[];
    setScoutMeta(
      scout
        ? {
            current_step: (scout.current_step as string | null) ?? null,
            city: (scout.city as string | null) ?? null,
          }
        : null,
    );

    const { data: vs } = await supabase
      .from("vs_candidate_venues")
      .select(
        "id, name, address, neighborhood, venue_type, size_sq_ft, capacity, website_url, venue_overview, notes",
      )
      .eq("scout_id", scoutId)
      .eq("pitched", true);
    const list = ((vs ?? []) as unknown) as Venue[];

    // Sort venues per saved deck_order. Unknown ids (newly-pitched
    // venues added since the last persisted order) anchor at the
    // end, preserving their natural sort order.
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

    const disp: Record<string, Display> = {};
    ordered.forEach((v) => {
      disp[v.id] = {
        size:
          v.size_sq_ft != null ? `${v.size_sq_ft.toLocaleString()} sq ft` : "",
        capacity: v.capacity != null ? `~${v.capacity}` : "",
      };
    });
    setDisplay(disp);

    if (ordered.length) {
      const ids = ordered.map((v) => v.id);
      const { data: ph } = await supabase
        .from("vs_venue_photos")
        .select("candidate_venue_id, slot, storage_path")
        .in("candidate_venue_id", ids)
        .order("slot");
      const counts: Record<string, number> = {};
      const urls: Record<string, (string | null)[]> = {};
      const rows = ph ?? [];
      const signedResults = await Promise.all(
        rows.map((p) =>
          supabase.storage
            .from("vs_venue_photos")
            .createSignedUrl(p.storage_path, 3600),
        ),
      );
      rows.forEach((p, i) => {
        counts[p.candidate_venue_id] =
          (counts[p.candidate_venue_id] ?? 0) + 1;
        if (!urls[p.candidate_venue_id])
          urls[p.candidate_venue_id] = [null, null, null, null];
        const idx = Math.max(1, Math.min(4, p.slot)) - 1;
        urls[p.candidate_venue_id][idx] =
          signedResults[i]?.data?.signedUrl ?? null;
      });
      setPhotoCounts(counts);
      setPhotoUrls(urls);
    } else {
      setPhotoCounts({});
      setPhotoUrls({});
    }
    setLoading(false);
  }, [scoutId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (orderTimer.current) clearTimeout(orderTimer.current);
      Object.values(fieldTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  function debounceSave(id: string, patch: FieldPatch) {
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? ({ ...v, ...patch } as Venue) : v)),
    );
    pendingFieldPatches.current[id] = {
      ...(pendingFieldPatches.current[id] ?? {}),
      ...patch,
    };
    clearTimeout(fieldTimers.current[id]);
    fieldTimers.current[id] = setTimeout(async () => {
      const toWrite = pendingFieldPatches.current[id];
      if (!toWrite) return;
      delete pendingFieldPatches.current[id];
      delete fieldTimers.current[id];
      const { error } = await supabase
        .from("vs_candidate_venues")
        .update(toWrite)
        .eq("id", id);
      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        load();
      }
    }, 600);
  }

  // Flush any in-flight debounced field saves immediately. Used by
  // generate() so vs-generate-deck reads the producer's post-edit
  // venue_overview value when it pushes to venues.about_venue.
  // Failure-survival contract: clear timers up front (so subsequent
  // debounceSave gets a clean cycle), but DELETE each pending patch
  // only AFTER its UPDATE succeeds, so a retry click re-flushes.
  async function flushPendingFieldSaves(): Promise<void> {
    const entries = Object.entries(pendingFieldPatches.current);
    if (entries.length === 0) return;
    for (const [id] of entries) {
      const t = fieldTimers.current[id];
      if (t) clearTimeout(t);
      delete fieldTimers.current[id];
    }
    const errors: string[] = [];
    await Promise.all(
      entries.map(async ([id, patch]) => {
        const { error } = await supabase
          .from("vs_candidate_venues")
          .update(patch)
          .eq("id", id);
        if (error) {
          errors.push(`${id}: ${error.message}`);
        } else {
          delete pendingFieldPatches.current[id];
        }
      }),
    );
    if (errors.length > 0) throw new Error(errors.join("; "));
  }

  function parseIntOrNull(raw: string): number | null {
    const cleaned = raw.replace(/[^\d]/g, "");
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  }

  function saveSize(id: string, raw: string) {
    setDisplay((d) => ({ ...d, [id]: { ...d[id], size: raw } }));
    debounceSave(id, { size_sq_ft: parseIntOrNull(raw) });
  }
  function saveCapacity(id: string, raw: string) {
    setDisplay((d) => ({ ...d, [id]: { ...d[id], capacity: raw } }));
    debounceSave(id, { capacity: parseIntOrNull(raw) });
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

  // Phase 5.12.14.3 Round 3 amendment v2 § 3: one-position arrow reorder.
  // Mirrors onRowDragEnd's arrayMove + persistOrder flow; the only delta
  // is computing newIdx from a direction token instead of a drop target.
  function moveByOne(venueId: string, direction: "up" | "down") {
    setVenues((prev) => {
      const idx = prev.findIndex((v) => v.id === venueId);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = arrayMove(prev, idx, newIdx);
      persistOrder(next);
      return next;
    });
  }

  async function reloadVenuePhotos(venueId: string) {
    const { data: ph } = await supabase
      .from("vs_venue_photos")
      .select("slot, storage_path")
      .eq("candidate_venue_id", venueId)
      .order("slot");
    const rows = ph ?? [];
    const slots: (string | null)[] = [null, null, null, null];
    const signedResults = await Promise.all(
      rows.map((p) =>
        supabase.storage
          .from("vs_venue_photos")
          .createSignedUrl(p.storage_path, 3600),
      ),
    );
    rows.forEach((p, i) => {
      const idx = Math.max(1, Math.min(4, p.slot)) - 1;
      slots[idx] = signedResults[i]?.data?.signedUrl ?? null;
    });
    setPhotoUrls((prev) => ({ ...prev, [venueId]: slots }));
    setPhotoCounts((prev) => ({ ...prev, [venueId]: rows.length }));
  }

  // Per-card click handler for the Regenerate Overview button. Reads
  // notes from React state (which is updated optimistically on every
  // keystroke; the 600ms debounce only affects DB) and passes them
  // explicitly in the request body so a producer who edits notes and
  // immediately regenerates doesn't race the debounce.
  async function regenerateOverview(venueId: string) {
    const venue = venues.find((v) => v.id === venueId);
    if (!venue || !scoutId || regenerating[venueId]) return;
    setRegenerating((m) => ({ ...m, [venueId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke(
        "vs-regenerate-venue-overview",
        {
          body: {
            venue_id: venueId,
            scout_id: scoutId,
            notes: venue.notes,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "regenerate failed");
      setVenues((prev) =>
        prev.map((v) =>
          v.id === venueId
            ? { ...v, venue_overview: data.venue_overview as string }
            : v,
        ),
      );
    } catch (e) {
      toast({
        title: "Could not regenerate overview",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRegenerating((m) => ({ ...m, [venueId]: false }));
    }
  }

  const includedVenues = useMemo(
    () => venues.filter((v) => included[v.id]),
    [venues, included],
  );
  const totalSlides =
    FRONT_MATTER_SLIDES + includedVenues.length * PER_VENUE_SLIDES;

  // Cluster C numbering: O(1) per-card lookup of the rank within the
  // included set only. Renumbers contiguously on uncheck so the pill
  // number matches the slide order vs-generate-deck will use.
  const includedRankByVenueId = useMemo(() => {
    const m = new Map<string, number>();
    let rank = 0;
    for (const v of venues) {
      if (included[v.id]) {
        rank += 1;
        m.set(v.id, rank);
      }
    }
    return m;
  }, [venues, included]);

  async function generate() {
    if (generating || includedVenues.length === 0 || !scoutId) return;
    setGenerating(true);
    if (orderTimer.current) {
      clearTimeout(orderTimer.current);
      orderTimer.current = null;
    }

    try {
      await flushPendingFieldSaves();
    } catch (e) {
      toast({
        title: "Could not save edits",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setGenerating(false);
      return;
    }

    const { error: rpcErr } = await supabase.rpc(
      "reset_scout_for_deck_regenerate",
      { target_scout_id: scoutId },
    );
    if (rpcErr) {
      toast({
        title: "Could not reset deck state",
        description: rpcErr.message,
        variant: "destructive",
      });
      setGenerating(false);
      return;
    }

    const { error: orderErr } = await supabase
      .from("vs_scouts")
      .update({ deck_order: venues.map((v) => v.id) })
      .eq("id", scoutId);
    if (orderErr) {
      toast({
        title: "Could not save deck order",
        description: orderErr.message,
        variant: "destructive",
      });
      setGenerating(false);
      return;
    }

    const includeResults = await Promise.all(
      venues.map((v) =>
        supabase
          .from("vs_candidate_venues")
          .update({ include_in_deck: !!included[v.id] })
          .eq("id", v.id),
      ),
    );
    const includeErr = includeResults.find((r) => r.error)?.error;
    if (includeErr) {
      toast({
        title: "Could not save venue selection",
        description: includeErr.message,
        variant: "destructive",
      });
      setGenerating(false);
      return;
    }

    nav(`/venue-scout/scouts/${scoutId}/deck/generating`);
  }

  const scoutCityId = useCityIdForName(scoutMeta?.city ?? null);
  const shortlistPath = `/venue-scout/scouts/${scoutId}/sourcing/shortlist`;

  if (loading) {
    return <div className="p-12 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        {/* R7 amendment v2 § 5: shared ScoutPageHeader. */}
        {scoutId && (
          <ScoutPageHeader scoutId={scoutId} scout={scoutMeta} />
        )}
        <h1 className="h-page">Review</h1>
      </header>

      {/* R6 § I.1: explainer body rewritten to cover the full Review-stage
          producer flow. */}
      <div className="hq-explainer">
        <div className="hq-explainer-label">Tip</div>
        <p className="hq-explainer-body">
          Final pass before deck generation. Edit any field in-line. Add
          internal notes or feedback — these are factored into Venue Overview
          paragraphs when Regenerated. Click any photo to upload photos for
          the deck. Click Generate Deck when you're ready.
        </p>
      </div>

      {/* R7 § C → R7 amendment v1 § 3: counter row right-aligned + text-base
          across Review / Sourcing / Shortlist. */}
      <div className="text-right text-base text-muted-foreground mb-3">
        <strong className="text-foreground">{includedVenues.length}</strong>{" "}
        Venues Selected
      </div>

      {venues.length === 0 ? (
        <div className="bg-surface-alt border border-border rounded-md p-10 text-center text-sm text-muted-foreground">
          No venues pitched yet.{" "}
          <Link to={shortlistPath} className="text-primary underline">
            Go back to shortlist
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
            <div className="space-y-6">
              {venues.map((v, i) => {
                const isIncluded = !!included[v.id];
                const rank = includedRankByVenueId.get(v.id) ?? null;
                return (
                  <ReviewCard
                    key={v.id}
                    venue={v}
                    includedOrderNum={rank}
                    included={isIncluded}
                    regenerating={!!regenerating[v.id]}
                    photoCount={photoCounts[v.id] ?? 0}
                    photoUrls={photoUrls[v.id] ?? [null, null, null, null]}
                    scoutCity={scoutMeta?.city ?? null}
                    scoutCityId={scoutCityId}
                    display={display[v.id] ?? {}}
                    canMoveUp={i > 0}
                    canMoveDown={i < venues.length - 1}
                    onMoveUp={() => moveByOne(v.id, "up")}
                    onMoveDown={() => moveByOne(v.id, "down")}
                    onToggleInclude={(next) =>
                      setIncluded((prev) => ({ ...prev, [v.id]: next }))
                    }
                    onSave={(patch) => debounceSave(v.id, patch)}
                    onSaveSize={(raw) => saveSize(v.id, raw)}
                    onSaveCapacity={(raw) => saveCapacity(v.id, raw)}
                    onRegenerate={() => void regenerateOverview(v.id)}
                    onOpenPhotos={() =>
                      setPhotoModal({ venueId: v.id, venueName: v.name })
                    }
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Sticky bottom nav */}
      <div className="actionbar">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to={shortlistPath} className="crumb">
            ← Back
          </Link>
          <div className="text-base text-muted-foreground">
            <strong className="text-foreground">{includedVenues.length}</strong>{" "}
            {includedVenues.length === 1 ? "venue" : "venues"} selected
            <span className="mx-2">·</span>
            <strong className="text-foreground">{totalSlides}</strong> total slides
            <span className="text-muted-foreground/70">
              {" "}
              ({FRONT_MATTER_SLIDES} front-end + 2 per venue)
            </span>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={generating || includedVenues.length === 0}
          >
            {generating ? "Generating…" : "Generate Deck →"}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (generating && !o) return;
          setConfirmOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate Deck</AlertDialogTitle>
            <AlertDialogDescription>
              Generating the deck will add the venues going into it to the HQ
              Venues database if they don't already match an existing venue.
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={generating}
              onClick={(event) => {
                event.preventDefault();
                void generate();
              }}
            >
              {generating ? "Generating…" : "Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
