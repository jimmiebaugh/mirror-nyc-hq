import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
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

// Lifted from VS Pro (src/pages/sourcing/SourcingReport.tsx) per port plan
// § 9 + Phase 4.6-port spec. Adapts:
//   - projectId -> id (scoutId)
//   - projects -> vs_scouts; venues -> vs_candidate_venues
//   - ranking_score column -> rank; type column -> venue_type
//   - venue_notes separate table -> vs_candidate_venues.notes inline column
//   - PageHeader component -> inline header pattern (matches 4.2 / 4.3 / 4.4
//     / 4.5 precedent)
//   - alignment pill tokens swapped to fixed Tailwind palette (green-400 /
//     amber-400) since VS Pro reads --warning which HQ doesn't define
//     (HQ has --warn instead; using fixed colors keeps both pills working
//     without a token-naming follow-up)

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
  // Phase 4.10.2-port: producer-visible Source pill in col2 + manual-at-top
  // sort. `source` is one of 'sheet' / 'research' / 'manual'; SourcePill
  // defensively renders 'Manual' for any non-canonical value.
  source: string | null;
  notes: string | null;
};

// Phase 4.10.2-port: shared shape for debounced inline-edit patches. Wider
// than VS Pro's manual-row inputs since SourcingReport now writes name,
// address, neighborhood, key_features from any row (not just manual). Mirrors
// Shortlist's VenuePatch shape so both pages stay consistent.
type VenuePatch = Partial<Omit<Venue, "key_features">> & {
  key_features?: string[] | string | null;
};

export default function SourcingReport() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [columns, setColumns] = useState<DerivedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // Phase 4.9-port: meta for <ScoutStepThroughNav />. Only the one column
  // the chrome cares about is pulled (current_step); the rest of vs_scouts
  // stays out of this page's working set.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null } | null
  >(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [activeVenue, setActiveVenue] = useState<Venue | null>(null);
  // Phase 4.10.2-port: per-venue 600ms debounce timer for inline edits.
  // Same shape as Shortlist + DeckPrep `debounceSave`. Replaces 4.6-port's
  // narrower `nameTimers` since col2 + col3 + col4 are all editable now.
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

  const load = useCallback(async () => {
    if (!scoutId) return;
    const [scoutResp, vsResp] = await Promise.all([
      supabase
        .from("vs_scouts")
        .select("derived_columns, current_step")
        .eq("id", scoutId)
        .maybeSingle(),
      supabase
        .from("vs_candidate_venues")
        .select(
          "id, name, neighborhood, address, venue_type, key_features, website_url, derived_attrs, recommendations, considerations, rank, shortlisted, source, notes",
        )
        .eq("scout_id", scoutId)
        .order("rank", { ascending: false, nullsFirst: false }),
    ]);

    const derived = (scoutResp.data?.derived_columns ?? []) as DerivedColumn[];
    setColumns(Array.isArray(derived) ? derived : []);
    setVenues(((vsResp.data ?? []) as unknown) as Venue[]);
    setScoutMeta(
      scoutResp.data
        ? {
            current_step: (scoutResp.data.current_step as string | null) ?? null,
          }
        : null,
    );
    setLoading(false);
  }, [scoutId]);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup any pending debounced saves on unmount so we don't write
  // through after the producer has navigated away.
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Phase 4.10.3-port: 3-tier source priority sort (manual -> sheet ->
  // research). SOURCE_PRIORITY constant lives in src/lib/venue-scout/format.ts
  // so SourcingReport + Shortlist stay in lock-step.
  //
  // Phase 4.10.4-port: secondary tiebreaker flipped from `rank desc` to
  // alphabetical-by-name. `sensitivity: "base"` ignores case; `numeric: true`
  // sorts "Studio 10" after "Studio 2" instead of before. The rank column
  // stays in the DB + tool schema (reversible UI hide only), so we no longer
  // read it in the sort.
  const sortedVenues = useMemo(() => {
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

  const shortlistedCount = useMemo(
    () => venues.filter((v) => v.shortlisted).length,
    [venues],
  );
  const canContinue = shortlistedCount >= 2;

  async function toggleShortlist(id: string, next: boolean) {
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? { ...v, shortlisted: next } : v)),
    );
    const { error } = await supabase
      .from("vs_candidate_venues")
      .update({ shortlisted: next })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      load();
    }
  }

  // Phase 4.10.2-port: generalized debounceSave covering every inline-edit
  // field on the matrix (name / address / neighborhood / key_features). Same
  // shape as Shortlist's existing debounceSave so consistency holds across
  // pages. `key_features` may arrive as a raw delimited string from the
  // Features textarea; we split-and-trim at the boundary so the in-memory
  // Venue keeps its array shape.
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
        toast.error(error.message);
        load();
      }
    }, 600);
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
        current_step: "shortlist",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav(`/venue-scout/scouts/${scoutId}/sourcing/shortlist`);
  }

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        <Link
          to={`/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`}
          className="crumb"
        >
          ← Sourcing
        </Link>
        <div className="flex items-end justify-between gap-5">
          <div className="space-y-2">
            <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
              Sourcing
            </div>
            <h1 className="h-page">Candidate Venues</h1>
          </div>
          <div className="flex items-end gap-4">
            <div className="text-[13px] text-muted-foreground">
              <strong className="text-foreground font-bold">
                {shortlistedCount}
              </strong>{" "}
              selected of{" "}
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
        Phase 4.10.2-port column overhaul: 8 -> 7 columns.
        Alignment | Rank column dropped; Rank moved into the Venue | Address
        cell stack via VenueIdentityStack. Col2 widened from 180px to 220px
        to absorb the rank bar + source pill. Total matrix width 1740 -> 1580.
        `columns` (derived alignment columns) stays read off vs_scouts but is
        no longer rendered; kept on the load() path so future surfaces can
        consume it without a re-fetch.
      */}
      <div className="bg-surface-alt rounded-md overflow-hidden border border-border">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1580px] border-collapse text-[12.5px]">
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 290 }} />
              <col style={{ width: 290 }} />
              <col style={{ width: 230 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <Th sticky="col1">Select</Th>
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
                    colSpan={7}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : sortedVenues.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    No candidates yet.
                  </td>
                </tr>
              ) : (
                sortedVenues.map((v) => {
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
                          checked={v.shortlisted}
                          onChange={(e) =>
                            toggleShortlist(v.id, e.target.checked)
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
                        <NotesCellButton note={note} onClick={() => openNotes(v)} />
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="actionbar">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link
            to={`/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`}
            className="crumb inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          <div className="flex-1 text-center text-xs text-muted-foreground">
            <strong className="text-foreground">{shortlistedCount}</strong>{" "}
            selected ·{" "}
            <strong className="text-foreground">2</strong> minimum to continue
          </div>
          <Button onClick={onContinue} disabled={!canContinue}>
            Continue · Shortlist →
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
