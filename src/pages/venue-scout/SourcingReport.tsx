import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Th } from "@/components/venue-scout/matrix/primitives";
import { VenueMatrixRow } from "@/components/venue-scout/matrix/VenueMatrixRow";
import { useVenueTypes } from "@/lib/venue-scout/useVenueTypes";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";
import { SOURCE_PRIORITY } from "@/lib/venue-scout/format";
import {
  HqVenuePicker,
  type HqVenueSelection,
} from "@/components/venue-scout/HqVenuePicker";
import { useCityIdForName } from "@/lib/hq/lookups";

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
  // sort. `source` is one of 'sheet' / 'research' / 'manual' / 'hq_pool';
  // SourcePill defensively renders 'Manual' for any non-canonical value.
  source: string | null;
  notes: string | null;
  // Phase 5.12.3: dedupe-meta affordance. Both fields read from
  // vs_candidate_venues; `dedupe_meta` is typed `unknown` because no
  // active UI consumer renders it (the matrix DedupeMetaIndicator was
  // pruned in Phase 5.12.14.2; the jsonb write path on
  // _shared/venueDedupe.ts stays for a future re-consumer).
  linked_venue_id: string | null;
  dedupe_meta: unknown;
};

// Phase 5.12.7 Feature A: total column count used by the loading + empty
// state placeholders + the new picker + manual-add rows pinned below the
// data rows.
const TOTAL_COLS = 6;

// Maps an HQ venues row's join shape to a slash-separated canonical-type
// string. Mirrors `hqVenueTypesToSlashJoined` in
// supabase/functions/vs-research-venues/index.ts so picker INSERT shape
// matches the auto-seed path byte-for-byte (admin-typed casing kept).
function hqVenueTypesToSlashJoined(
  hq: Pick<HqVenueSelection, "venue_venue_types">,
): string | null {
  const tokens = (hq.venue_venue_types ?? [])
    .map((j) => j?.venue_types?.name ?? null)
    .filter((n): n is string => Boolean(n))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }
  return unique.length > 0 ? unique.join(" / ") : null;
}

// Phase 4.10.2-port: shared shape for debounced inline-edit patches. Wider
// than VS Pro's manual-row inputs since SourcingReport now writes name,
// address, neighborhood, key_features from any row (not just manual). Mirrors
// Shortlist's VenuePatch shape so both pages stay consistent.
//
// Phase 5.12.3: explicit editable column set instead of `Partial<Omit<Venue,
// ...>>`. Deriving from `Venue` widens the patch type every time a new
// read-only field lands on the local type (e.g. `linked_venue_id` +
// `dedupe_meta` from 5.12.3), letting `debounceSave({ dedupe_meta: ... })`
// compile + run as a literal UPDATE against vs_candidate_venues even though
// those columns are server-written by vs-generate-deck.pushVenuesToHq.
// Mirrors DeckPrep's `FieldPatch` pattern (also explicit column list).
// `shortlisted` is mutated through `toggleShortlist` (separate direct
// .update); `notes` flows through Review's inline notes field
// (post-5.12.15 unified surface); neither belongs here.
//
// Phase 5.12.7 Feature C: `website_url` widens the patch type so manual rows
// can persist the inline URL field. Non-manual rows skip the affordance
// (the website column on those rows stays a read-only WebsiteArrow inside
// VenueIdentityStack).
type VenuePatch = {
  name?: string;
  address?: string | null;
  neighborhood?: string | null;
  venue_type?: string | null;
  key_features?: string[] | string | null;
  website_url?: string | null;
};

export default function SourcingReport() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [columns, setColumns] = useState<DerivedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // Phase 4.9-port: meta consumed by <ScoutPhaseBreadcrumb /> (the
  // post-5.12.14 chrome replacement for the retired ScoutStepThroughNav).
  // Phase 5.12.7 widens this to include `city` so the HQ Venue picker can
  // scope its typeahead to the scout's brief city.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; city: string | null } | null
  >(null);
  // Phase 5.12.7 Feature C: id of the most recently inserted manual row.
  // Passed through to <VenueIdentityStack autoFocusName> so the new
  // contenteditable name span receives focus on mount. Plumbing lifted
  // from Shortlist's pre-5.12.7 location with the manual-add row.
  const [lastManualId, setLastManualId] = useState<string | null>(null);
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
        .select("derived_columns, current_step, city")
        .eq("id", scoutId)
        .maybeSingle(),
      supabase
        .from("vs_candidate_venues")
        .select(
          "id, name, neighborhood, address, venue_type, key_features, website_url, derived_attrs, recommendations, considerations, rank, shortlisted, source, notes, linked_venue_id, dedupe_meta",
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
            current_step:
              (scoutResp.data.current_step as string | null) ?? null,
            city: (scoutResp.data.city as string | null) ?? null,
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

  // Phase 5.12.7 Feature C: one-shot reset of lastManualId after the new
  // manual row's <EditableField> has had its mount-effect fire. Without
  // this, a remount of the manual row's tr later (edge case where a sort
  // step swaps the manual row's tree position and React tears it down)
  // would refire autoFocusName at remount-time and steal focus from
  // whichever cell the producer is currently editing. Lifted verbatim
  // from Shortlist's pre-5.12.7 location.
  useEffect(() => {
    if (lastManualId == null) return;
    const handle = window.requestAnimationFrame(() => setLastManualId(null));
    return () => window.cancelAnimationFrame(handle);
  }, [lastManualId]);

  // Phase 5.12.7 Feature A: set of `linked_venue_id` already present in
  // this scout's matrix. Read for display purposes today; passed into the
  // picker so a future "already in matrix" visual hint has the data.
  const existingLinkedSet = useMemo(() => {
    const s = new Set<string>();
    for (const v of venues) {
      if (v.linked_venue_id) s.add(v.linked_venue_id);
    }
    return s;
  }, [venues]);

  // Phase 5.12.7 post-smoke: producer-added rows (manual-add + HQ
  // picker) should pin to the BOTTOM of the visible table instead of
  // sorting to the top via SOURCE_PRIORITY (manual is priority 1,
  // hq_pool is priority 3). This `Set` tracks rows added IN THE CURRENT
  // SESSION; sortedVenues partitions on it. On reload the rows sort to
  // their natural position. Session-only is deliberate: the "added now"
  // UX is what producers care about; persistent reordering would need a
  // new column and is overkill for v1.
  const [newlyAddedIds, setNewlyAddedIds] = useState<string[]>([]);

  // Phase 5.12.7 post-smoke: Continue button blocks on auto-research for
  // producer-added (manual + hq_pool) rows that still lack per-brief
  // judgment. The modal renders a real spinner + per-row progress so the
  // producer understands the ~10-30s wait instead of staring at a bare
  // button-label tweak. Shape:
  //   - `open`: drives <Dialog>; cannot be dismissed by the producer
  //     while in flight (no overlay-close, no Escape, no X button).
  //   - `total` / `completed` / `failed`: rolling counters updated as
  //     each vs-research-single-venue invoke resolves.
  //   - `names`: stable list of the venues being enriched so the producer
  //     sees what is being worked on.
  const [enrichmentModal, setEnrichmentModal] = useState<{
    open: boolean;
    total: number;
    completed: number;
    failed: number;
    names: string[];
  }>({ open: false, total: 0, completed: 0, failed: 0, names: [] });
  const continuing = enrichmentModal.open;

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
    // Phase 5.12.7 post-smoke: partition into pre-existing rows (sort by
    // SOURCE_PRIORITY then alphabetical name) + newly-added-this-session
    // rows (rendered in insertion order at the BOTTOM). The session
    // partition is component-local; on reload, every row sorts to its
    // natural position via SOURCE_PRIORITY.
    const newlyAddedSet = new Set(newlyAddedIds);
    const existing = venues.filter((v) => !newlyAddedSet.has(v.id));
    existing.sort((a, b) => {
      const aPri = SOURCE_PRIORITY[a.source ?? "research"] ?? 99;
      const bPri = SOURCE_PRIORITY[b.source ?? "research"] ?? 99;
      if (aPri !== bPri) return aPri - bPri;
      return (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    // Render newly-added rows in insertion order. Look them up against the
    // current `venues` list (some rows may have been deleted out from
    // under us; tolerate gracefully).
    const venueById = new Map(venues.map((v) => [v.id, v]));
    const newlyAdded = newlyAddedIds
      .map((id) => venueById.get(id))
      .filter((v): v is Venue => Boolean(v));
    return [...existing, ...newlyAdded];
  }, [venues, newlyAddedIds]);

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
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
        toast({ title: "Error", description: error.message, variant: "destructive" });
        load();
      }
    }, 600);
  }

  // Phase 5.12.7 Feature C: addManualRow moved here from Shortlist as part
  // of the manual-add row relocation. The setLastManualId signal drives
  // <VenueIdentityStack autoFocusName> so the new contenteditable name
  // span receives focus on mount.
  //
  // Phase 5.12.13.1 amendment: shortlisted defaults to true. A producer
  // who manually adds a row almost always intends to advance it to
  // shortlist (the manual add IS the inclusion gesture). Defaulting true
  // closes the gap where a forgotten Shortlist checkbox left the row
  // visible on Shortlist (via the `v.shortlisted || v.source === "manual"`
  // render filter) but bypassed SourcingReport.onContinue's research fan-
  // out (which gates on `!v.shortlisted`). The producer can still untick
  // the row if they change their mind before Continue.
  async function addManualRow() {
    if (!scoutId) return;
    const { data, error } = await supabase
      .from("vs_candidate_venues")
      .insert({
        scout_id: scoutId,
        name: "",
        source: "manual",
        shortlisted: true,
      })
      .select("*")
      .single();
    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const inserted = data as unknown as Venue;
    setVenues((prev) => [...prev, inserted]);
    setLastManualId(inserted.id);
    setNewlyAddedIds((prev) => [...prev, inserted.id]);
  }

  // Phase 5.12.7 Feature A: HQ Venue picker selection handler. Pre-INSERT
  // SELECT dedupes against (scout_id, linked_venue_id); on hit, toast +
  // skip (no INSERT). On miss, INSERT mirrors loadHqVenuesIntoPool's shape
  // in vs-research-venues/index.ts byte-for-byte (source='hq_pool',
  // linked_venue_id set, structured fields populated verbatim from the HQ
  // row, venues.about_venue copied verbatim into venue_overview). No auto-
  // research at insert time; per-brief judgment lands via compile-time
  // Pass 1 backstop (or Feature B at next research run). Optimistic
  // local-state update on success; rollback + reload on failure.
  const handleHqVenueSelected = useCallback(
    async (hq: HqVenueSelection) => {
      if (!scoutId) return;
      const { data: existing, error: existingErr } = await supabase
        .from("vs_candidate_venues")
        .select("id")
        .eq("scout_id", scoutId)
        .eq("linked_venue_id", hq.id)
        .limit(1)
        .maybeSingle();
      if (existingErr) {
        toast({
          title: "Error",
          description: existingErr.message,
          variant: "destructive",
        });
        return;
      }
      if (existing) {
        toast({ title: "Already in this scout's matrix" });
        return;
      }
      const sizeSqFt = hq.total_sq_ft ?? hq.square_footage ?? null;
      // Phase 5.12.13.1 amendment: shortlisted defaults to true (same
      // rationale as addManualRow): a producer who picks an HQ venue from
      // the picker is signaling inclusion intent; defaulting true closes
      // the gap where the row appeared on Shortlist but bypassed the
      // SourcingReport.onContinue research fan-out gate (`!v.shortlisted`).
      const insertPayload = {
        scout_id: scoutId,
        name: hq.name,
        address: hq.address,
        neighborhood: hq.neighborhood,
        venue_type: hqVenueTypesToSlashJoined(hq),
        website_url: hq.website_url,
        size_sq_ft: sizeSqFt,
        capacity: hq.capacity,
        key_features: Array.isArray(hq.features) ? hq.features : [],
        venue_overview: hq.about_venue,
        linked_venue_id: hq.id,
        source: "hq_pool",
        shortlisted: true,
      };
      const { data: inserted, error: insErr } = await supabase
        .from("vs_candidate_venues")
        .insert(insertPayload)
        .select("*")
        .single();
      if (insErr || !inserted) {
        toast({
          title: "Error",
          description: insErr?.message ?? "Insert failed",
          variant: "destructive",
        });
        return;
      }
      const newRow = inserted as unknown as Venue;
      setVenues((prev) => [...prev, newRow]);
      setNewlyAddedIds((prev) => [...prev, newRow.id]);
      toast({ title: `Added ${hq.name}` });
    },
    [scoutId],
  );

  async function onContinue() {
    if (!scoutId || !canContinue || continuing) return;
    // Phase 5.12.7 post-smoke: before transitioning to Shortlist, enrich
    // every producer-added row (manual + hq_pool) that BOTH still lacks
    // per-brief judgment AND has been selected for shortlist on this
    // page. Producer-added rows skip Feature B (research-time enrichment
    // is keyed to the research-pipeline lifecycle; rows added via picker
    // / manual-add land AFTER research). Gating on `shortlisted=true`
    // saves the per-row Claude spend (~$0.02-0.05) for rows the
    // producer is NOT moving forward; if they add a row + decide not to
    // select it, no research fires. If they later select it from
    // Shortlist (or come back to SourcingReport and check the box),
    // they'll have to manually re-research via a follow-on lever once we
    // add one. Best-effort: per-row failure surfaces a summary toast
    // after the modal closes but does not block the transition (failed
    // rows stay bare on Shortlist and the producer can edit inline).
    const unenriched = venues.filter((v) => {
      if (v.source !== "manual" && v.source !== "hq_pool") return false;
      if (!v.shortlisted) return false;
      const recs = Array.isArray(v.recommendations) ? v.recommendations : [];
      if (recs.length > 0) return false;
      // Skip rows that have no name yet (producer left the manual-add
      // row blank). Research needs a name to start from.
      if (!v.name || v.name.trim().length === 0) return false;
      return true;
    });

    const finishAndNavigate = async (failureSummary: string | null) => {
      const { error } = await supabase
        .from("vs_scouts")
        .update({
          current_step: "shortlist",
          last_touched_at: new Date().toISOString(),
        })
        .eq("id", scoutId);
      if (error) {
        setEnrichmentModal((m) => ({ ...m, open: false }));
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      setEnrichmentModal((m) => ({ ...m, open: false }));
      if (failureSummary) {
        toast({
          title: "Auto-research had failures",
          description: failureSummary,
          variant: "destructive",
        });
      }
      nav(`/venue-scout/scouts/${scoutId}/sourcing/shortlist`);
    };

    if (unenriched.length === 0) {
      // Nothing to enrich; transition immediately without opening the
      // modal so the producer's Continue feels instant.
      await finishAndNavigate(null);
      return;
    }

    setEnrichmentModal({
      open: true,
      total: unenriched.length,
      completed: 0,
      failed: 0,
      names: unenriched.map((v) => v.name),
    });

    const results = await Promise.all(
      unenriched.map(async (v) => {
        try {
          const { error: invokeErr } = await supabase.functions.invoke(
            "vs-research-single-venue",
            { body: { venue_id: v.id, scout_id: scoutId } },
          );
          const ok = !invokeErr;
          setEnrichmentModal((m) => ({
            ...m,
            completed: m.completed + 1,
            failed: m.failed + (ok ? 0 : 1),
          }));
          return {
            id: v.id,
            name: v.name,
            ok,
            error: invokeErr,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setEnrichmentModal((m) => ({
            ...m,
            completed: m.completed + 1,
            failed: m.failed + 1,
          }));
          return {
            id: v.id,
            name: v.name,
            ok: false,
            error: { message: msg },
          };
        }
      }),
    );

    const failed = results.filter((r) => !r.ok);
    const failureSummary =
      failed.length > 0
        ? failed
            .map((r) => `${r.name || r.id}: ${r.error?.message ?? "unknown"}`)
            .join("; ")
        : null;
    await finishAndNavigate(failureSummary);
  }

  // Phase 5.12.9: page-level resolve of scout city -> cities.id so each
  // matrix-row neighborhood picker can parent-scope. Resolved once and
  // threaded into every row instead of N per-row hooks.
  const scoutCityId = useCityIdForName(scoutMeta?.city ?? null);

  // Phase 5.12.10: runtime canonical venue-types set. Threaded into
  // parseTypes so legacy data not in the runtime set renders as
  // fallback-styled pills; TypeTogglePopover reads the same set via
  // its own useVenueTypes call.
  const { names: availableTypes } = useVenueTypes();

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        {/* R7 amendment v2 § 5: shared ScoutPageHeader replaces the
            inline crumb + breadcrumb + gear pairing. */}
        {scoutId && (
          <ScoutPageHeader scoutId={scoutId} scout={scoutMeta} />
        )}
        <h1 className="h-page">Candidate Venues</h1>
      </header>

      {/* R6 § G.1: explainer card added at the top of Sourcing. Uses the
          canonical .hq-explainer chrome (post-R3 Tip card). */}
      <div className="hq-explainer">
        <div className="hq-explainer-label">Tip</div>
        <p className="hq-explainer-body">
          Edit any field in-line. Add Database venues or manual additions at
          the bottom of the table (these get researched upon moving to
          Shortlist). Select the venues you want to advance to Shortlist and
          click Continue.
        </p>
      </div>

      {/* R6 amendment v1 § 6 + R7 § C → R7 amendment v1 § 3: counter row
          right-aligned + text-base across Review / Sourcing / Shortlist. */}
      <div className="mb-3 text-right text-base text-muted-foreground">
        <strong className="text-foreground font-bold">
          {shortlistedCount}
        </strong>{" "}
        selected of{" "}
        <strong className="text-foreground font-bold">
          {venues.length}
        </strong>
      </div>

      {/*
        Phase 4.10.2-port column overhaul: 8 -> 7 columns.
        Alignment | Rank column dropped; Rank moved into the Venue | Address
        cell stack via VenueIdentityStack. Col2 widened from 180px to 220px
        to absorb the rank bar + source pill. Total matrix width 1740 -> 1580.
        `columns` (derived alignment columns) stays read off vs_scouts but is
        no longer rendered; kept on the load() path so future surfaces can
        consume it without a re-fetch.
      */}
      <div className="tbl-wrap bg-surface-alt">
        <div className="overflow-x-auto scrollbar-thin">
          {/* R7 § A → R7 amendment v1 § 2: matrix tables use `.tbl--matrix`
              standalone (not composed with `.tbl`). Composing with .tbl
              had .tbl's base td/tr/thead specificity overriding the
              matrix's Tailwind-utility primitives (header alignment, td
              padding, special-row hover tints, cell-divider pseudo bar
              over content). `.tbl--matrix` carries width + min-width +
              table-fixed; matrix primitives carry everything else. */}
          <table className="tbl--matrix text-base">
            <colgroup>
              <col style={{ width: 90 }} />
              <col style={{ width: 260 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 180 }} />
              <col />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <Th sticky="col1">
                  <Check className="mx-auto h-4 w-4" aria-label="Select" />
                </Th>
                <Th sticky="col2">Venue</Th>
                <Th>Website</Th>
                <Th>Features</Th>
                <Th>Recommendations</Th>
                <Th>Considerations</Th>
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
              ) : sortedVenues.length === 0 ? (
                <tr>
                  <td
                    colSpan={TOTAL_COLS}
                    className="px-6 py-16 text-center text-muted-foreground"
                  >
                    No candidates yet.
                  </td>
                </tr>
              ) : (
                sortedVenues.map((v) => (
                  <VenueMatrixRow
                    key={v.id}
                    venue={v}
                    col1={{
                      label: "Shortlist",
                      value: v.shortlisted,
                      onToggle: (next) => toggleShortlist(v.id, next),
                    }}
                    onNameChange={(n) => debounceSave(v.id, { name: n })}
                    onAddressChange={(a) =>
                      debounceSave(v.id, { address: a })
                    }
                    onWebsiteSave={async (next) => {
                      const { error } = await supabase
                        .from("vs_candidate_venues")
                        .update({ website_url: next.trim() || null })
                        .eq("id", v.id);
                      if (error) throw error;
                      setVenues((prev) =>
                        prev.map((row) =>
                          row.id === v.id
                            ? { ...row, website_url: next.trim() || null }
                            : row,
                        ),
                      );
                    }}
                    onNeighborhoodChange={(next) =>
                      debounceSave(v.id, { neighborhood: next })
                    }
                    onTypesChange={(next) =>
                      debounceSave(v.id, {
                        venue_type: next.length > 0 ? next.join(" / ") : null,
                      })
                    }
                    onFeaturesChange={(next) =>
                      debounceSave(v.id, { key_features: next })
                    }
                    scoutCityId={scoutCityId}
                    scoutCityName={scoutMeta?.city ?? null}
                    availableTypes={availableTypes}
                    autoFocusName={v.id === lastManualId}
                  />
                ))
              )}

              {/*
                Phase 5.12.7 Feature A: HQ Venue picker row. Pinned below
                the data rows. Shows during loading + empty + populated
                states so the affordance is discoverable on a fresh
                scout. The component renders its own <tr> (amber whole-
                row button wrapped in a Popover anchor; cmdk typeahead
                inside the popover).
              */}
              {scoutId ? (
                <HqVenuePicker
                  scoutId={scoutId}
                  scoutCity={scoutMeta?.city ?? null}
                  existingLinkedVenueIds={existingLinkedSet}
                  onSelected={handleHqVenueSelected}
                  colSpan={TOTAL_COLS}
                />
              ) : null}

              {/*
                Phase 5.12.7 Feature C: manual-add row relocated from
                Shortlist. Same bg-primary/5 callout styling as the
                pre-5.12.7 Shortlist version.
              */}
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

      <div className="actionbar">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link
            to={`/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`}
            className="crumb inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          {/* R6 § G.2: text-xs → text-base to match Review's action bar
              center text. */}
          <div className="flex-1 text-center text-base text-muted-foreground">
            <strong className="text-foreground">{shortlistedCount}</strong>{" "}
            selected ·{" "}
            <strong className="text-foreground">2</strong> minimum to continue
          </div>
          <Button
            onClick={onContinue}
            disabled={!canContinue || continuing}
          >
            Continue · Shortlist →
          </Button>
        </div>
      </div>

      {/*
        Phase 5.12.7 post-smoke: Continue button drives this modal
        while vs-research-single-venue fans out for every unenriched
        producer-added row (manual + hq_pool). Dialog ignores overlay
        click + Escape so the producer can't dismiss mid-fan-out and
        end up navigating before enrichment completes. onOpenChange is
        wired to a no-op for the same reason; the page itself closes
        the modal once finishAndNavigate resolves.
      */}
      <Dialog
        open={enrichmentModal.open}
        onOpenChange={() => {
          /* deliberately a no-op: the modal closes on completion only */
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Phase 5.12.14.3 R5 amendment v2 § 2a: gap-3 (12px) overrides
              shadcn DialogHeader's default gap-2 (8px) so title-to-description
              reads breathably. Escalate to gap-4 if smoke still flags as
              tight. */}
          <DialogHeader className="gap-3">
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Enriching Added Venues
            </DialogTitle>
            <DialogDescription>
              Researching the{" "}
              <strong className="text-foreground">
                {enrichmentModal.total}
              </strong>{" "}
              venue{enrichmentModal.total === 1 ? "" : "s"} added to supplement
              with features, recommendations and considerations per the brief:
            </DialogDescription>
          </DialogHeader>
          {/* Phase 5.12.14.3 R5 amendment v1 § 2: element reorder
              (names -> bar -> X-of-X -> footer; body text leads into the
              names list via a trailing colon). amendment v2 § 2b dropped the
              prior mt-4 because it stacked with DialogContent's own gap-4
              (32px total description-to-names); shadcn's natural gap-4 alone
              produces a balanced 16px. */}
          <div className="space-y-5">
            {enrichmentModal.names.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground space-y-1">
                {enrichmentModal.names.map((n, i) => (
                  <li key={`${n}-${i}`} className="truncate">
                    · {n}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-input">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width:
                    enrichmentModal.total === 0
                      ? "0%"
                      : `${Math.round(
                          (enrichmentModal.completed / enrichmentModal.total) *
                            100,
                        )}%`,
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">
                {enrichmentModal.completed}
              </strong>{" "}
              of{" "}
              <strong className="text-foreground">
                {enrichmentModal.total}
              </strong>{" "}
              complete.
              {enrichmentModal.failed > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="text-amber-400">
                    {enrichmentModal.failed}
                  </span>{" "}
                  failed
                </>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground italic">
              Research takes 10 seconds per venue. This window closes when
              finished.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
