import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NotesModal } from "@/components/venue-scout/NotesModal";
import {
  Th,
  Td,
  HdrStack,
  VStack,
  Bullets,
  NotesCellButton,
  parseTypes,
  EditableField,
  EditableTextarea,
  VenueIdentityStack,
  TypeTogglePopover,
} from "@/components/venue-scout/matrix/primitives";
import type { CanonicalType } from "@/components/venue-scout/matrix/primitives";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";
import { SOURCE_PRIORITY } from "@/lib/venue-scout/format";

// Lifted from VS Pro (src/pages/sourcing/Shortlist.tsx) per port plan § 9 +
// Phase 4.6-port spec. Same column-rename / route-prefix / table-rename
// adapts as SourcingReport, plus:
//   - Photo column: 4.6-port stubbed the upload affordance (toast no-op,
//     photoCounts always 0). 4.7.1-port unstubs it: real counts query
//     against vs_venue_photos + real PhotoUploadModal open on pitched rows.
//   - Manual venue add: inserts with `source: 'manual', shortlisted: false`
//     to match VS Pro behavior. The filter `v.shortlisted || v.source ===
//     'manual'` makes manual rows visible on Shortlist regardless of the
//     shortlisted flag. See spec § "Open decision points" #4.

type DerivedColumn = { id: string; label: string; criteria?: string };

type Venue = {
  id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  venue_type: string | null;
  key_features: string[] | null;
  website_url: string | null;
  derived_attrs: Record<string, string> | null;
  recommendations: string[] | null;
  considerations: string[] | null;
  rank: number | null;
  shortlisted: boolean;
  pitched: boolean;
  source: string;
  notes: string | null;
};

// Phase 4.10.2-port: 9 -> 8 columns after dropping the Alignment | Rank
// column.
// Phase 4.10.4-port: 8 -> 7 columns after dropping the Upload Photos column.
// Photos still live on Review.tsx; the upload affordance is gone from
// Shortlist per producer-flow simplification (Jimmie lock 2026-05-13).
const TOTAL_COLS = 7;

export default function Shortlist() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [columns, setColumns] = useState<DerivedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // Phase 4.9-port: meta for <ScoutStepThroughNav />.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; generated_decks: unknown } | null
  >(null);

  const [notesOpen, setNotesOpen] = useState(false);
  const [activeVenue, setActiveVenue] = useState<Venue | null>(null);
  // Phase 4.10.2-port: id of the most recently inserted manual row. Passed
  // through to <VenueIdentityStack autoFocusName> so the new contenteditable
  // span receives focus on mount. Replaces the previous setTimeout +
  // querySelector("input[data-manual-name=...]") path, which only worked when
  // manual rows rendered as <input> elements.
  const [lastManualId, setLastManualId] = useState<string | null>(null);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  const load = useCallback(async () => {
    if (!scoutId) return;
    const [scoutResp, vsResp] = await Promise.all([
      supabase
        .from("vs_scouts")
        .select("derived_columns, current_step, generated_decks")
        .eq("id", scoutId)
        .maybeSingle(),
      supabase
        .from("vs_candidate_venues")
        .select(
          "id, name, neighborhood, address, venue_type, key_features, website_url, derived_attrs, recommendations, considerations, rank, shortlisted, pitched, source, notes",
        )
        .eq("scout_id", scoutId),
    ]);

    const derived = (scoutResp.data?.derived_columns ?? []) as DerivedColumn[];
    setColumns(Array.isArray(derived) ? derived : []);
    setScoutMeta(
      scoutResp.data
        ? {
            current_step: (scoutResp.data.current_step as string | null) ?? null,
            generated_decks: scoutResp.data.generated_decks,
          }
        : null,
    );

    const all = ((vsResp.data ?? []) as unknown) as Venue[];
    const visible = all.filter(
      (v) => v.shortlisted || v.source === "manual",
    );
    setVenues(visible);

    setLoading(false);
  }, [scoutId]);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup any pending debounced saves on unmount.
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Phase 4.10.2-port: one-shot reset of lastManualId after the new
  // manual row's <EditableField> has had its mount-effect fire. Without
  // this, if the manual row's tr ever remounts later (e.g. an edge case
  // where the sort step swaps the manual row's tree position and React
  // tears it down), autoFocusName would still be true at remount-time
  // and steal focus from whichever cell the producer is currently
  // editing. Clearing on requestAnimationFrame gives the contenteditable
  // its initial focus, then takes the signal back down before any
  // subsequent reconciliation can fire it a second time.
  useEffect(() => {
    if (lastManualId == null) return;
    const handle = window.requestAnimationFrame(() =>
      setLastManualId(null),
    );
    return () => window.cancelAnimationFrame(handle);
  }, [lastManualId]);

  // Phase 4.10.3-port: 3-tier source priority sort (manual -> sheet ->
  // research). Mirrors SourcingReport. SOURCE_PRIORITY lives in
  // src/lib/venue-scout/format.ts.
  //
  // Phase 4.10.4-port: secondary tiebreaker flipped from `rank desc` to
  // alphabetical-by-name (case-insensitive + numeric collation). Rank column
  // still lives in the DB; display is hidden only.
  const sorted = useMemo(() => {
    const arr = [...venues];
    arr.sort((a, b) => {
      const aPri = SOURCE_PRIORITY[a.source ?? "research"] ?? 99;
      const bPri = SOURCE_PRIORITY[b.source ?? "research"] ?? 99;
      if (aPri !== bPri) return aPri - bPri;
      return (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    return arr;
  }, [venues]);

  const pitchCount = venues.filter((v) => v.pitched).length;
  const canContinue = pitchCount >= 2;

  async function togglePitch(id: string, next: boolean) {
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? { ...v, pitched: next } : v)),
    );
    const { error } = await supabase
      .from("vs_candidate_venues")
      .update({ pitched: next })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      load();
    }
  }

  // `key_features` arrives from the manual-row <input> as a raw delimited
  // string. Widen the patch type at the call boundary so we can accept it,
  // but split immediately so the in-memory Venue keeps its array shape
  // (otherwise any consumer reading v.key_features as an array would
  // explode on a string at runtime; the `as unknown as string[]` cast that
  // used to live in the call site was a type-lie).
  type VenuePatch = Partial<Omit<Venue, "key_features">> & {
    key_features?: string[] | string | null;
  };

  function debounceSave(id: string, patch: VenuePatch) {
    const normalized: Partial<Venue> = (() => {
      if (typeof patch.key_features !== "string") {
        return patch as Partial<Venue>;
      }
      const arr = patch.key_features
        .split(/[,;|\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return { ...patch, key_features: arr } as Partial<Venue>;
    })();

    setVenues((prev) =>
      prev.map((v) => (v.id === id ? ({ ...v, ...normalized } as Venue) : v)),
    );
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(async () => {
      const { error } = await supabase
        .from("vs_candidate_venues")
        .update(normalized)
        .eq("id", id);
      if (error) {
        // Phase 4.10.2-port: align Shortlist with SourcingReport + DeckPrep --
        // on save failure, reload from DB so the optimistic update gets
        // rolled back. Previously 4.6-port only toasted (acceptable when
        // the only editable fields were on manual rows the producer just
        // typed); 4.10.2 extends editing to every research / sheet row, so
        // a silent stale-state on the matrix would be worse.
        toast.error(error.message);
        load();
      }
    }, 600);
  }

  async function addManualRow() {
    if (!scoutId) return;
    const { data, error } = await supabase
      .from("vs_candidate_venues")
      .insert({
        scout_id: scoutId,
        name: "",
        source: "manual",
        shortlisted: false,
      })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const inserted = (data as unknown) as Venue;
    setVenues((prev) => [...prev, inserted]);
    // Phase 4.10.2-port: signal <VenueIdentityStack autoFocusName> for this
    // new row. The contenteditable name span focuses on its mount-effect
    // (no setTimeout / querySelector needed; the previous DOM-query path
    // only worked when manual rows rendered as <input> elements).
    setLastManualId(inserted.id);
  }

  function openNotes(v: Venue) {
    setActiveVenue(v);
    setNotesOpen(true);
  }

  async function onContinue() {
    if (!scoutId || !canContinue) return;
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "review_selects",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav(`/venue-scout/scouts/${scoutId}/sourcing/review`);
  }

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        <Link
          to={`/venue-scout/scouts/${scoutId}/sourcing/report`}
          className="crumb"
        >
          ← Sourcing
        </Link>
        <div className="flex items-end justify-between gap-5">
          <div className="space-y-2">
            <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
              Sourcing
            </div>
            <h1 className="h-page">Venue Shortlist</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Mark the venues you want to pitch. Add notes per venue and pull
              in any manual additions before continuing.
            </p>
          </div>
          <div className="flex items-end gap-4">
            <div className="text-[13px] text-muted-foreground">
              <strong className="text-foreground font-bold">{pitchCount}</strong>{" "}
              marked for pitch of{" "}
              <strong className="text-foreground font-bold">
                {venues.length}
              </strong>
            </div>
            {scoutId && <ScoutSettingsLink scoutId={scoutId} />}
          </div>
        </div>
      </header>
      {scoutId && <ScoutStepThroughNav scoutId={scoutId} scout={scoutMeta} />}

      {/*
        Phase 4.10.2-port matrix overhaul:
          - 9 -> 8 columns (Alignment | Rank dropped; Rank moved into col2
            via <VenueIdentityStack>).
          - Col2 widened 200 -> 230 to absorb rank bar + source pill.
          - Manual vs research vs sheet row branching collapsed: ALL rows
            use <VenueIdentityStack> in col2, <EditableField variant="neigh">
            in col3 top, and <EditableTextarea> for Features in col4. Type
            pills stay static (AI-derived; producer-edit is a 4.10.3 polish
            item). Recommendations + Considerations stay <Bullets> for all
            rows (AI-only; intentional affordance asymmetry vs Features).
          - The hardcoded "Manual" pill is gone; <SourcePill> inside
            <VenueIdentityStack> renders Uploaded / Sourced / Manual.
          - Total matrix width 1740 -> 1580.
          - `columns` (derived alignment columns) stays read off vs_scouts
            (no longer rendered; kept for parity with SourcingReport).

        Phase 4.10.4-port: 8 -> 7 columns. Upload Photos column dropped;
        photo upload now lives only on Review.tsx (4.7.1-port surface).
        Total matrix width 1580 -> 1450.
      */}
      <div className="bg-surface-alt rounded-md overflow-hidden border border-border">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1450px] border-collapse text-[12.5px]">
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 230 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <Th sticky="col1">Pitch</Th>
                <Th sticky="col2"><HdrStack a="Venue" b="Address" /></Th>
                <Th><HdrStack a="Neighborhood" b="Type" /></Th>
                <Th>Features</Th>
                <Th>Recommendations</Th>
                <Th>Considerations</Th>
                <Th>Notes /<br />Feedback</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={TOTAL_COLS}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={TOTAL_COLS}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    No shortlisted venues. Go back and shortlist some.
                  </td>
                </tr>
              ) : (
                sorted.map((v) => {
                  const types = parseTypes(v.venue_type);
                  const note = v.notes ?? undefined;
                  return (
                    <tr
                      key={v.id}
                      className="border-t border-border [&>td]:border-r [&>td]:border-border [&>td:last-child]:border-r-0"
                      style={{ height: 1 }}
                    >
                      <Td vCenter sticky="col1" className="text-center">
                        <input
                          type="checkbox"
                          checked={v.pitched}
                          onChange={(e) =>
                            togglePitch(v.id, e.target.checked)
                          }
                          className="h-[18px] w-[18px] accent-[hsl(var(--primary))] cursor-pointer align-middle"
                        />
                      </Td>
                      <Td noPadX noPadY sticky="col2">
                        <VenueIdentityStack
                          venueId={v.id}
                          name={v.name}
                          onNameChange={(n) =>
                            debounceSave(v.id, { name: n })
                          }
                          address={v.address ?? ""}
                          onAddressChange={(a) =>
                            debounceSave(v.id, {
                              address: a.trim() || null,
                            })
                          }
                          website={v.website_url}
                          source={v.source}
                          autoFocusName={v.id === lastManualId}
                        />
                      </Td>
                      <Td noPadX noPadY>
                        <VStack
                          dividerPad={18}
                          top={
                            <EditableField
                              id={`${v.id}-neigh`}
                              value={v.neighborhood ?? ""}
                              onChange={(n) =>
                                debounceSave(v.id, {
                                  neighborhood: n.trim() || null,
                                })
                              }
                              variant="neighborhood"
                              placeholder="(no neighborhood)"
                            />
                          }
                          bot={
                            <TypeTogglePopover
                              currentTypes={types}
                              onChange={(next: CanonicalType[]) =>
                                debounceSave(v.id, {
                                  venue_type:
                                    next.length > 0 ? next.join(" / ") : null,
                                })
                              }
                            />
                          }
                        />
                      </Td>
                      <Td vCenter>
                        <EditableTextarea
                          id={`${v.id}-features`}
                          value={(v.key_features ?? []).join(", ")}
                          onChange={(raw) =>
                            debounceSave(v.id, { key_features: raw })
                          }
                          placeholder="(no features)"
                          rows={6}
                        />
                      </Td>
                      <Td vCenter>
                        <Bullets items={v.recommendations ?? []} />
                      </Td>
                      <Td vCenter>
                        <Bullets items={v.considerations ?? []} />
                      </Td>
                      <Td vCenter className="text-center">
                        <NotesCellButton
                          note={note}
                          onClick={() => openNotes(v)}
                        />
                      </Td>
                    </tr>
                  );
                })
              )}

              <tr
                className="border-t border-border bg-primary/5 hover:bg-primary/10 cursor-pointer"
                onClick={addManualRow}
              >
                <td
                  colSpan={TOTAL_COLS}
                  className="px-6 py-4 text-center text-primary text-xs font-bold uppercase tracking-[0.14em]"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-3.5 w-3.5" /> Manually Add Venue
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link
            to={`/venue-scout/scouts/${scoutId}/sourcing/report`}
            className="crumb inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          <div className="flex-1 text-center text-xs text-muted-foreground">
            <strong className="text-foreground">{pitchCount}</strong> marked for
            pitch ·{" "}
            <strong className="text-foreground">2</strong> minimum to continue
          </div>
          <Button onClick={onContinue} disabled={!canContinue}>
            Continue · Review Selects →
          </Button>
        </div>
      </div>

      <NotesModal
        open={notesOpen}
        onOpenChange={setNotesOpen}
        venueId={activeVenue?.id ?? null}
        venueName={activeVenue?.name ?? ""}
        initialContent={activeVenue?.notes ?? ""}
        onSaved={(content) => {
          if (activeVenue) {
            setVenues((prev) =>
              prev.map((v) =>
                v.id === activeVenue.id ? { ...v, notes: content } : v,
              ),
            );
          }
        }}
      />
    </div>
  );
}
