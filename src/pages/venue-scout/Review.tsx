// Phase 4.7.1-port: Review Selects page.
//
// Lifted from VS Pro src/pages/sourcing/Review.tsx with the standard port
// adapts: route prefix /projects -> /venue-scout/scouts, table renames
// (venues -> vs_candidate_venues, venue_photos -> vs_venue_photos), column
// renames (type -> venue_type, venue_id -> candidate_venue_id, project_id
// -> scout_id), HQ design token swaps (surface -> bg-surface-alt,
// surface-2 -> bg-input, success token -> green-400), HQ canonical Field
// from src/components/ui/Field.tsx (VS Pro inline Field dropped), inline
// header (no PageHeader, per 4.2-4.6 precedent), signed-URL photo display
// (fixes VS Pro's placeholder-for-both stub at PhotoSlot).
//
// Confirm + Compile Deck writes current_step='compiling' and navigates to
// /sourcing/compiling. That route 404s until 4.7.2-port lands the Compiling
// page + vs-compile-summaries edge function.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/Field";
import { PhotoUploadModal } from "@/components/venue-scout/PhotoUploadModal";
import {
  CANONICAL_TYPES,
  parseTypes,
  TYPE_STYLES,
  type CanonicalType,
} from "@/lib/venue-scout/venueTypes";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";

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
  pitched: boolean;
};

// Display strings for size/capacity that allow free-form input
// (commas, "TBD", "~500") between keystroke and debounced parse.
type Display = { size?: string; capacity?: string };

const inputCls =
  "w-full bg-transparent border border-transparent rounded px-2 py-1 text-sm leading-snug text-foreground hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors";

export default function Review() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  // ------- All hooks above any early return (design-system § 12 rule 2) -------
  const [venues, setVenues] = useState<Venue[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, (string | null)[]>>({});
  const [display, setDisplay] = useState<Record<string, Display>>({});
  const [loading, setLoading] = useState(true);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activeVenue, setActiveVenue] = useState<Venue | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Phase 4.9-port: meta for <ScoutStepThroughNav />. Pulled in parallel
  // with the candidate-venues fetch so the chrome can render without a
  // second mount-time round-trip.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; generated_decks: unknown } | null
  >(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    if (!scoutId) return;
    const [{ data: vs }, { data: scoutRow }] = await Promise.all([
      supabase
        .from("vs_candidate_venues")
        .select(
          "id, name, address, neighborhood, venue_type, size_sq_ft, capacity, website_url, venue_overview, pitched",
        )
        .eq("scout_id", scoutId)
        .eq("pitched", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("vs_scouts")
        .select("current_step, generated_decks")
        .eq("id", scoutId)
        .maybeSingle(),
    ]);
    setScoutMeta(
      scoutRow
        ? {
            current_step: (scoutRow.current_step as string | null) ?? null,
            generated_decks: scoutRow.generated_decks,
          }
        : null,
    );
    const list = ((vs ?? []) as unknown) as Venue[];
    setVenues(list);

    const disp: Record<string, Display> = {};
    list.forEach((v) => {
      disp[v.id] = {
        size: v.size_sq_ft != null ? `${v.size_sq_ft.toLocaleString()} sq ft` : "",
        capacity: v.capacity != null ? `~${v.capacity}` : "",
      };
    });
    setDisplay(disp);

    if (list.length) {
      const ids = list.map((v) => v.id);
      const { data: ph } = await supabase
        .from("vs_venue_photos")
        .select("candidate_venue_id, slot, storage_path")
        .in("candidate_venue_id", ids)
        .order("slot");
      const counts: Record<string, number> = {};
      // urls[venueId] is a 4-element array, slot-1 indexed (slot 1 -> index 0).
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
        counts[p.candidate_venue_id] = (counts[p.candidate_venue_id] ?? 0) + 1;
        if (!urls[p.candidate_venue_id]) urls[p.candidate_venue_id] = [null, null, null, null];
        const idx = Math.max(1, Math.min(4, p.slot)) - 1;
        urls[p.candidate_venue_id][idx] = signedResults[i]?.data?.signedUrl ?? null;
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
    const t = timers.current;
    return () => {
      Object.values(t).forEach((id) => clearTimeout(id));
    };
  }, []);

  function debounceSave(id: string, patch: Partial<Venue>) {
    setVenues((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      const { error } = await supabase
        .from("vs_candidate_venues")
        .update(patch)
        .eq("id", id);
      if (error) toast.error(error.message);
    }, 600);
  }

  function saveSize(id: string, raw: string) {
    setDisplay((d) => ({ ...d, [id]: { ...d[id], size: raw } }));
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    debounceSave(id, { size_sq_ft: isNaN(n) ? null : n });
  }
  function saveCapacity(id: string, raw: string) {
    setDisplay((d) => ({ ...d, [id]: { ...d[id], capacity: raw } }));
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    debounceSave(id, { capacity: isNaN(n) ? null : n });
  }

  function toggleType(v: Venue, t: CanonicalType) {
    const current = parseTypes(v.venue_type);
    const next = current.includes(t)
      ? current.filter((x) => x !== t)
      : [...current, t];
    debounceSave(v.id, { venue_type: next.join(" / ") || null });
  }

  function openPhotos(v: Venue) {
    setActiveVenue(v);
    setPhotoOpen(true);
  }

  async function refreshVenuePhotos(venueId: string) {
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

  async function confirmCompile() {
    if (!scoutId || confirming) return;
    setConfirming(true);
    // Flush any pending debounced edits so a producer who clicks Continue
    // mid-keystroke doesn't lose them on unmount (code-reviewer CONSIDER #9).
    // We cancel the scheduled setTimeout and apply the venues state -- which
    // was already updated optimistically in debounceSave -- to the DB
    // explicitly. Fire-and-forget the writes; the navigate is more important
    // than waiting on each.
    const pendingIds = Object.keys(timers.current);
    if (pendingIds.length) {
      pendingIds.forEach((id) => clearTimeout(timers.current[id]));
      const flushes = pendingIds.map((id) => {
        const v = venues.find((x) => x.id === id);
        if (!v) return Promise.resolve(undefined);
        return supabase
          .from("vs_candidate_venues")
          .update({
            name: v.name,
            address: v.address,
            neighborhood: v.neighborhood,
            venue_type: v.venue_type,
            size_sq_ft: v.size_sq_ft,
            capacity: v.capacity,
            website_url: v.website_url,
            venue_overview: v.venue_overview,
          })
          .eq("id", id);
      });
      await Promise.all(flushes);
      timers.current = {};
    }
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "compiling",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast.error(error.message);
      setConfirming(false);
      return;
    }
    nav(`/venue-scout/scouts/${scoutId}/sourcing/compiling`);
  }

  const fullPhotoSets = venues.filter((v) => (photoCounts[v.id] ?? 0) >= 4).length;
  const shortlistPath = `/venue-scout/scouts/${scoutId}/sourcing/shortlist`;

  if (loading) {
    return (
      <div className="p-12 text-sm text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        <Link to={shortlistPath} className="crumb">
          ← Sourcing Shortlist
        </Link>
        <div className="flex items-end justify-between gap-5">
          <div className="space-y-2">
            <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
              Sourcing
            </div>
            <h1 className="h-page">Review Selects</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Final pass before deck compilation. One card per venue going into
              the pitch. Review summaries, confirm photos, edit if needed.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <Link
              to={shortlistPath}
              className="text-[13px] font-mono uppercase tracking-wider text-primary hover:underline"
            >
              ← Edit Selections
            </Link>
            {scoutId && <ScoutSettingsLink scoutId={scoutId} />}
          </div>
        </div>
      </header>
      {scoutId && <ScoutStepThroughNav scoutId={scoutId} scout={scoutMeta} />}

      {venues.length === 0 ? (
        <div className="bg-surface-alt border border-border rounded-md p-10 text-center text-sm text-muted-foreground">
          No venues pitched yet.{" "}
          <Link to={shortlistPath} className="text-primary underline">
            Go back to shortlist
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-6">
          {venues.map((v) => {
            const types = parseTypes(v.venue_type);
            const count = photoCounts[v.id] ?? 0;
            const slotUrls = photoUrls[v.id] ?? [null, null, null, null];
            return (
              <div
                key={v.id}
                className="bg-surface-alt rounded-md p-7 border border-border"
              >
                <div className="flex items-start justify-between gap-4 mb-6">
                  <input
                    value={v.name}
                    onChange={(e) => debounceSave(v.id, { name: e.target.value })}
                    className="bg-transparent border border-transparent rounded px-2 py-1 text-2xl font-black uppercase tracking-tight w-full hover:bg-input focus:bg-input focus:border-primary focus:outline-none transition-colors"
                  />
                  <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.14em] bg-input text-muted-foreground">
                    Pitch ✓
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
                  {/* LEFT: fields */}
                  <div className="space-y-4">
                    <Field label="Address">
                      <textarea
                        rows={2}
                        value={v.address ?? ""}
                        onChange={(e) =>
                          debounceSave(v.id, { address: e.target.value })
                        }
                        className={inputCls + " resize-none"}
                      />
                    </Field>
                    <Field label="Neighborhood">
                      <input
                        value={v.neighborhood ?? ""}
                        onChange={(e) =>
                          debounceSave(v.id, { neighborhood: e.target.value })
                        }
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Type">
                      <div className="flex flex-wrap gap-1.5 px-1 py-1">
                        {CANONICAL_TYPES.map((t) => {
                          const active = types.includes(t);
                          return (
                            <button
                              key={t}
                              onClick={() => toggleType(v, t)}
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.04em] border transition-opacity ${
                                active
                                  ? TYPE_STYLES[t]
                                  : "bg-transparent text-muted-foreground/50 border-border hover:text-muted-foreground"
                              }`}
                            >
                              {active ? (
                                t
                              ) : (
                                <>
                                  <Plus className="h-2.5 w-2.5 mr-1 inline" />
                                  {t}
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Field label="Size">
                      <input
                        value={display[v.id]?.size ?? ""}
                        onChange={(e) => saveSize(v.id, e.target.value)}
                        className={inputCls}
                        placeholder="e.g. 25,000 sq ft"
                      />
                    </Field>
                    <Field label="Capacity">
                      <input
                        value={display[v.id]?.capacity ?? ""}
                        onChange={(e) => saveCapacity(v.id, e.target.value)}
                        className={inputCls}
                        placeholder="e.g. ~500 or TBD"
                      />
                    </Field>
                    <Field label="Website">
                      <div className="flex items-center gap-1">
                        <input
                          value={v.website_url ?? ""}
                          onChange={(e) =>
                            debounceSave(v.id, {
                              website_url: e.target.value || null,
                            })
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
                    </Field>
                    <Field label="Overview">
                      <textarea
                        rows={6}
                        value={v.venue_overview ?? ""}
                        onChange={(e) =>
                          debounceSave(v.id, { venue_overview: e.target.value })
                        }
                        placeholder="Populated after compile."
                        className={inputCls + " resize-y"}
                      />
                    </Field>
                  </div>

                  {/* RIGHT: photos */}
                  <div>
                    <PhotoMeta count={count} />
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      {[0, 1, 2, 3].map((i) => (
                        <PhotoSlot
                          key={i}
                          // hasPhoto reads the per-slot URL array, not the
                          // total count: photos can land non-contiguously
                          // (e.g. slots 1 + 3 occupied, slot 2 empty) and
                          // an index-vs-count check would lie at the empty
                          // gap. See code-reviewer MUST FIX #2.
                          hasPhoto={!!slotUrls[i]}
                          photoUrl={slotUrls[i] ?? null}
                          onClick={() => openPhotos(v)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link
            to={shortlistPath}
            className="crumb inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Shortlist
          </Link>
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">{venues.length}</strong> venues
            to pitch
            <span className="mx-2">·</span>
            <strong className="text-foreground">{fullPhotoSets}</strong> with
            full photo sets
          </div>
          <Button
            onClick={confirmCompile}
            disabled={venues.length === 0 || confirming}
          >
            Confirm + Compile Deck →
          </Button>
        </div>
      </div>

      <PhotoUploadModal
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        scoutId={scoutId ?? ""}
        venueId={activeVenue?.id ?? null}
        venueName={activeVenue?.name ?? ""}
        onSaved={(c) => {
          if (activeVenue) {
            setPhotoCounts((p) => ({ ...p, [activeVenue.id]: c }));
            // Refresh signed URLs for the row whose photos changed so the
            // Review-card thumbnails reflect the save without a hard reload.
            refreshVenuePhotos(activeVenue.id);
          }
        }}
      />
    </div>
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
      ⊕ <strong className="text-foreground">0 / 4</strong> photos uploaded ·
      upload to fill the slide
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
  // Spec § 4d locked decision: render actual signed URL when hasPhoto. VS Pro's
  // source had a stub (placeholder for both states) awaiting real wiring.
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
