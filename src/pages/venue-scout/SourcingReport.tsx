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
  Pill,
  Bullets,
  RankDisplay,
  NotesCellButton,
  parseTypes,
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  EditableVenueName,
  WebsiteArrow,
} from "@/components/venue-scout/matrix/primitives";

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
  notes: string | null;
};

export default function SourcingReport() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [columns, setColumns] = useState<DerivedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [activeVenue, setActiveVenue] = useState<Venue | null>(null);
  const nameTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
          "id, name, neighborhood, address, venue_type, key_features, website_url, derived_attrs, recommendations, considerations, rank, shortlisted, notes",
        )
        .eq("scout_id", scoutId)
        .order("rank", { ascending: false, nullsFirst: false }),
    ]);

    const derived = (scoutResp.data?.derived_columns ?? []) as DerivedColumn[];
    setColumns(Array.isArray(derived) ? derived : []);
    setVenues(((vsResp.data ?? []) as unknown) as Venue[]);
    setLoading(false);
  }, [scoutId]);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup any pending debounced name-saves on unmount so we don't write
  // through after the producer has navigated away.
  useEffect(() => {
    const timers = nameTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

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

  function saveName(id: string, name: string) {
    setVenues((prev) =>
      prev.map((v) => (v.id === id ? { ...v, name } : v)),
    );
    clearTimeout(nameTimers.current[id]);
    nameTimers.current[id] = setTimeout(async () => {
      const { error } = await supabase
        .from("vs_candidate_venues")
        .update({ name })
        .eq("id", id);
      if (error) toast.error(error.message);
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
          <div className="text-[13px] text-muted-foreground">
            <strong className="text-foreground font-bold">
              {shortlistedCount}
            </strong>{" "}
            selected of{" "}
            <strong className="text-foreground font-bold">
              {venues.length}
            </strong>
          </div>
        </div>
      </header>

      <div className="bg-surface-alt rounded-md overflow-hidden border border-border">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1740px] border-collapse text-[12.5px]">
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 200 }} />
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
                <Th><HdrStack a="Alignment" b="Rank" /></Th>
                <Th>Recommendations</Th>
                <Th>Considerations</Th>
                <Th>Notes /<br />Feedback</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : venues.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    No candidates yet.
                  </td>
                </tr>
              ) : (
                venues.map((v) => {
                  const types = parseTypes(v.venue_type);
                  const addrParts = (v.address ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
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
                        <VStack
                          top={
                            <EditableVenueName
                              id={v.id}
                              name={v.name}
                              onChange={(n) => saveName(v.id, n)}
                            />
                          }
                          bot={
                            <div className="flex flex-col items-center gap-[2px] text-muted-foreground">
                              {addrParts.length ? (
                                addrParts.map((p, i) => <div key={i}>{p}</div>)
                              ) : (
                                <div>-</div>
                              )}
                              {v.website_url ? (
                                <div className="pt-[10px]">
                                  <WebsiteArrow url={v.website_url} />
                                </div>
                              ) : null}
                            </div>
                          }
                        />
                      </Td>
                      <Td noPadX noPadY>
                        <VStack
                          top={
                            <div className="text-foreground">
                              {v.neighborhood ?? "-"}
                            </div>
                          }
                          bot={
                            <div className="flex flex-col items-center gap-[7px]">
                              {types.length ? (
                                types.map((t, i) => (
                                  <Pill
                                    key={i}
                                    className={
                                      TYPE_STYLES[t] ?? TYPE_FALLBACK_STYLE
                                    }
                                  >
                                    {t}
                                  </Pill>
                                ))
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          }
                        />
                      </Td>
                      <Td vCenter>
                        <Bullets items={v.key_features ?? []} />
                      </Td>
                      <Td noPadX noPadY>
                        <VStack
                          dividerPad={10}
                          top={
                            <div className="flex flex-wrap gap-[5px] items-center justify-center">
                              {columns.map((c) => {
                                const val = v.derived_attrs?.[c.id];
                                if (val === "yes")
                                  return (
                                    <Pill
                                      key={c.id}
                                      className="bg-green-400/15 text-green-400 border-green-400/35"
                                    >
                                      {c.label}
                                    </Pill>
                                  );
                                if (val === "maybe")
                                  return (
                                    <Pill
                                      key={c.id}
                                      className="bg-amber-400/15 text-amber-400 border-amber-400/35"
                                    >
                                      {c.label}
                                    </Pill>
                                  );
                                return null;
                              })}
                            </div>
                          }
                          bot={<RankDisplay score={v.rank} />}
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

      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur">
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
