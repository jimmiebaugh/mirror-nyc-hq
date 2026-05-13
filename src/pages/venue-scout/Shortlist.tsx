import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NotesModal } from "@/components/venue-scout/NotesModal";
import { PhotoUploadModal } from "@/components/venue-scout/PhotoUploadModal";
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
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";

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

const TOTAL_COLS = 9;

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
  const [photosOpen, setPhotosOpen] = useState(false);
  const [activeVenue, setActiveVenue] = useState<Venue | null>(null);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

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

    // 4.7.1-port: real photo counts (4.6-port stub returned 0 always).
    if (visible.length) {
      const ids = visible.map((v) => v.id);
      const { data: ph } = await supabase
        .from("vs_venue_photos")
        .select("candidate_venue_id")
        .in("candidate_venue_id", ids);
      const counts: Record<string, number> = {};
      (ph ?? []).forEach((p) => {
        counts[p.candidate_venue_id] = (counts[p.candidate_venue_id] ?? 0) + 1;
      });
      setPhotoCounts(counts);
    } else {
      setPhotoCounts({});
    }

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

  const sorted = useMemo(() => {
    const arr = [...venues];
    arr.sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));
    arr.sort(
      (a, b) =>
        Number(a.source === "manual") - Number(b.source === "manual"),
    );
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
      if (error) toast.error(error.message);
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
    setVenues((prev) => [...prev, (data as unknown) as Venue]);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-manual-name="${(data as { id: string }).id}"]`,
      );
      el?.focus();
    }, 50);
  }

  function openNotes(v: Venue) {
    setActiveVenue(v);
    setNotesOpen(true);
  }

  function openPhotos(v: Venue) {
    if (!v.pitched) return;
    setActiveVenue(v);
    setPhotosOpen(true);
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
          ← Sourcing Report
        </Link>
        <div className="flex items-end justify-between gap-5">
          <div className="space-y-2">
            <div className="text-[14px] font-mono uppercase tracking-widest text-primary">
              Sourcing
            </div>
            <h1 className="h-page">Venue Shortlist</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Mark the venues you want to pitch. Add notes per venue, upload
              deck photos for the pitched ones, and pull in any manual
              additions before continuing.
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

      <div className="bg-surface-alt rounded-md overflow-hidden border border-border">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1740px] border-collapse text-[12.5px]">
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 230 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <Th sticky="col1">Pitch</Th>
                <Th sticky="col2"><HdrStack a="Venue" b="Address" /></Th>
                <Th><HdrStack a="Neighborhood" b="Type" /></Th>
                <Th>Features</Th>
                <Th><HdrStack a="Alignment" b="Rank" /></Th>
                <Th>Recommendations</Th>
                <Th>Considerations</Th>
                <Th>Upload<br />Photos</Th>
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
                  const isManual = v.source === "manual";
                  const types = parseTypes(v.venue_type);
                  const addrParts = (v.address ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const note = v.notes ?? undefined;
                  const phCount = photoCounts[v.id] ?? 0;
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
                        {isManual ? (
                          <div className="h-full flex flex-col justify-center px-3 py-3 gap-1.5">
                            <input
                              data-manual-name={v.id}
                              defaultValue={v.name}
                              placeholder="Venue name"
                              onChange={(e) =>
                                debounceSave(v.id, { name: e.target.value })
                              }
                              className="ghost-input w-full font-bold text-[16px]"
                            />
                            <input
                              defaultValue={v.address ?? ""}
                              placeholder="Address"
                              onChange={(e) =>
                                debounceSave(v.id, { address: e.target.value })
                              }
                              className="ghost-input w-full text-[12px] text-muted-foreground"
                            />
                            <span className="manual-tag">Manual</span>
                          </div>
                        ) : (
                          <VStack
                            top={
                              <EditableVenueName
                                id={v.id}
                                name={v.name}
                                onChange={(n) =>
                                  debounceSave(v.id, { name: n })
                                }
                              />
                            }
                            bot={
                              <div className="flex flex-col items-center gap-[2px] text-muted-foreground">
                                {addrParts.length ? (
                                  addrParts.map((p, i) => (
                                    <div key={i}>{p}</div>
                                  ))
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
                        )}
                      </Td>
                      <Td noPadX noPadY>
                        {isManual ? (
                          <div className="h-full flex flex-col justify-center px-3 py-3 gap-2">
                            <input
                              defaultValue={v.neighborhood ?? ""}
                              placeholder="Neighborhood"
                              onChange={(e) =>
                                debounceSave(v.id, {
                                  neighborhood: e.target.value,
                                })
                              }
                              className="ghost-input w-full text-[12.5px]"
                            />
                            <input
                              defaultValue={v.venue_type ?? ""}
                              placeholder="Type"
                              onChange={(e) =>
                                debounceSave(v.id, {
                                  venue_type: e.target.value,
                                })
                              }
                              className="ghost-input w-full text-[12px] text-muted-foreground"
                            />
                          </div>
                        ) : (
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
                                  <span className="text-muted-foreground">
                                    -
                                  </span>
                                )}
                              </div>
                            }
                          />
                        )}
                      </Td>
                      <Td vCenter>
                        {isManual ? (
                          <input
                            defaultValue={(v.key_features ?? []).join(", ")}
                            placeholder="Key features"
                            onChange={(e) =>
                              debounceSave(v.id, {
                                key_features: e.target.value,
                              })
                            }
                            className="ghost-input w-full text-[12.5px]"
                          />
                        ) : (
                          <Bullets items={v.key_features ?? []} />
                        )}
                      </Td>
                      <Td noPadX noPadY>
                        {isManual ? (
                          <div className="h-full flex items-center justify-center text-muted-foreground">
                            -
                          </div>
                        ) : (
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
                        )}
                      </Td>
                      <Td vCenter>
                        {isManual ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <Bullets items={v.recommendations ?? []} />
                        )}
                      </Td>
                      <Td vCenter>
                        {isManual ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <Bullets items={v.considerations ?? []} />
                        )}
                      </Td>
                      <Td vCenter className="text-center">
                        <UploadPhotosButton
                          pitched={v.pitched}
                          count={phCount}
                          onClick={() => openPhotos(v)}
                        />
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

      <PhotoUploadModal
        open={photosOpen}
        onOpenChange={setPhotosOpen}
        scoutId={scoutId ?? ""}
        venueId={activeVenue?.id ?? null}
        venueName={activeVenue?.name ?? ""}
        onSaved={(c) => {
          if (activeVenue) {
            setPhotoCounts((prev) => ({ ...prev, [activeVenue.id]: c }));
          }
        }}
      />
    </div>
  );
}

function UploadPhotosButton({
  pitched,
  count,
  onClick,
}: {
  pitched: boolean;
  count: number;
  onClick: () => void;
}) {
  if (!pitched) {
    return (
      <button
        title="Mark for Pitch to enable photo upload"
        disabled
        className="w-full px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] rounded bg-input text-muted-foreground cursor-not-allowed border border-border"
      >
        - Locked
      </button>
    );
  }
  if (count >= 4) {
    return (
      <button
        onClick={onClick}
        className="w-full px-2 py-2 rounded bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/40 hover:bg-[#22c55e]/25 transition-colors"
      >
        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] leading-tight">
          ✓ Complete
        </span>
        <span className="block text-[10px] opacity-80 leading-tight mt-0.5">
          (4 / 4)
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="w-full px-2 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      <span className="block text-[10px] font-bold uppercase tracking-[0.12em] leading-tight">
        + Upload
      </span>
      <span className="block text-[10px] opacity-90 leading-tight mt-0.5">
        ({count} / 4)
      </span>
    </button>
  );
}
