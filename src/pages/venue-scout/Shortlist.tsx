import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Th } from "@/components/venue-scout/matrix/primitives";
import { VenueMatrixRow } from "@/components/venue-scout/matrix/VenueMatrixRow";
import { useVenueTypes } from "@/lib/venue-scout/useVenueTypes";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";
import { SOURCE_PRIORITY } from "@/lib/venue-scout/format";
import { useCityIdForName } from "@/lib/hq/lookups";

// Lifted from VS Pro (src/pages/sourcing/Shortlist.tsx) per port plan § 9 +
// Phase 4.6-port spec. Same column-rename / route-prefix / table-rename
// adapts as SourcingReport, plus:
//   - Photo column: 4.6-port stubbed the upload affordance (toast no-op,
//     photoCounts always 0). 4.7.1-port unstubs it: real counts query
//     against vs_venue_photos + real PhotoUploadModal open on pitched rows.
//
// Phase 5.12.7 Feature C: manual-add row + addManualRow function + the
// autoFocusName plumbing have moved to SourcingReport (where the new
// + Add Venue from HQ Venue List picker now lives in a sibling row).
//
// Phase 5.12.7 post-smoke 2026-05-24: the auto-research-on-promotion
// trigger moved from this page's pitch-toggle handler to
// SourcingReport's Continue button. Producer expectation is now: all
// producer-added rows are enriched by the time Shortlist renders, so
// the pitch toggle stays a pure boolean and the Continue button on
// Sourcing is the single enrichment fan-out point.
//
// Phase 5.12.13.1 amendment B follow-on (2026-05-24): the page's visibility
// filter dropped the `|| v.source === "manual"` override so the select
// checkbox is the single source of truth for which venues advance to
// Shortlist. Pairs with amendment B's `shortlisted: true` default on
// manual + HQ-picker INSERTs, which keeps the happy path identical while
// honoring the producer's explicit untick.

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
  // Phase 5.12.3: dedupe-meta affordance. Both fields read from
  // vs_candidate_venues; `dedupe_meta` is typed `unknown` because no
  // active UI consumer renders it (the matrix DedupeMetaIndicator was
  // pruned in Phase 5.12.14.2; the jsonb write path on
  // _shared/venueDedupe.ts stays for a future re-consumer).
  linked_venue_id: string | null;
  dedupe_meta: unknown;
};

// Phase 4.10.2-port: 9 -> 8 columns after dropping the Alignment | Rank
// column.
// Phase 4.10.4-port: 8 -> 7 columns after dropping the Upload Photos column.
// Photos still live on Review.tsx; the upload affordance is gone from
// Shortlist per producer-flow simplification (Jimmie lock 2026-05-13).
const TOTAL_COLS = 6;

export default function Shortlist() {
  const { id: scoutId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [columns, setColumns] = useState<DerivedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // Phase 4.9-port: meta consumed by <ScoutPhaseBreadcrumb /> (the
  // post-5.12.14 chrome replacement for the retired ScoutStepThroughNav).
  // Phase 5.12.9 widens to include `city` so the per-row neighborhood
  // picker can parent-scope to the scout's brief city.
  const [scoutMeta, setScoutMeta] = useState<
    { current_step: string | null; city: string | null } | null
  >(null);

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
          "id, name, neighborhood, address, venue_type, key_features, website_url, derived_attrs, recommendations, considerations, rank, shortlisted, pitched, source, notes, linked_venue_id, dedupe_meta",
        )
        .eq("scout_id", scoutId),
    ]);

    const derived = (scoutResp.data?.derived_columns ?? []) as DerivedColumn[];
    setColumns(Array.isArray(derived) ? derived : []);
    setScoutMeta(
      scoutResp.data
        ? {
            current_step: (scoutResp.data.current_step as string | null) ?? null,
            city: (scoutResp.data.city as string | null) ?? null,
          }
        : null,
    );

    const all = ((vsResp.data ?? []) as unknown) as Venue[];
    // Phase 5.12.13.1 amendment B follow-on: the select checkbox is the
    // single source of truth for Shortlist visibility. Pre-amendment this
    // filter unioned `v.shortlisted || v.source === "manual"` so manual
    // rows always appeared regardless of the checkbox (the pre-amendment-B
    // manual default was `shortlisted: false` and the union kept them
    // visible). With amendment B's `shortlisted: true` default on manual +
    // HQ-picker INSERTs, manual rows pass the simple `v.shortlisted` gate
    // naturally on the happy path, and the producer's explicit untick is
    // now honored (manual rows disappear from Shortlist when unticked
    // back on SourcingReport).
    const visible = all.filter((v) => v.shortlisted);
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
      toast({ title: "Error", description: error.message, variant: "destructive" });
      load();
    }
  }

  // `key_features` arrives from the manual-row <input> as a raw delimited
  // string. Widen the patch type at the call boundary so we can accept it,
  // but split immediately so the in-memory Venue keeps its array shape
  // (otherwise any consumer reading v.key_features as an array would
  // explode on a string at runtime; the `as unknown as string[]` cast that
  // used to live in the call site was a type-lie).
  //
  // Phase 5.12.3: explicit editable column set instead of `Partial<Omit<Venue,
  // ...>>`. Deriving from `Venue` widens the patch type every time a new
  // read-only field lands on the local type (e.g. `linked_venue_id` +
  // `dedupe_meta` from 5.12.3), letting `debounceSave({ dedupe_meta: ... })`
  // compile + run as a literal UPDATE against vs_candidate_venues even though
  // those columns are server-written by vs-generate-deck.pushVenuesToHq.
  // Mirrors DeckPrep's `FieldPatch` pattern (also explicit column list).
  // `pitched` is mutated through `togglePitch` (separate direct .update);
  // `notes` flows through Review's inline notes field (post-5.12.15 unified
  // surface); neither belongs on this surface.
  type VenuePatch = {
    name?: string;
    address?: string | null;
    neighborhood?: string | null;
    venue_type?: string | null;
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
        toast({ title: "Error", description: error.message, variant: "destructive" });
        load();
      }
    }, 600);
  }

  async function onContinue() {
    if (!scoutId || !canContinue) return;
    // Phase 5.12.15: skip the standalone Final Review step. Flip
    // current_step directly to 'compiling' so vs-compile-summaries
    // picks it up (its `.eq("current_step", "compiling")` guard is
    // unchanged), then route to /sourcing/compiling.
    const { error } = await supabase
      .from("vs_scouts")
      .update({
        current_step: "compiling",
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scoutId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    nav(`/venue-scout/scouts/${scoutId}/sourcing/compiling`);
  }

  // Phase 5.12.9: page-level resolve of scout city -> cities.id so each
  // matrix-row neighborhood picker can parent-scope (resolved once,
  // threaded into every row).
  const scoutCityId = useCityIdForName(scoutMeta?.city ?? null);

  // Phase 5.12.10: runtime canonical venue-types set. Threaded into
  // parseTypes; TypeTogglePopover reads the same set via its own
  // useVenueTypes call.
  const { names: availableTypes } = useVenueTypes();

  return (
    <div className="pb-32">
      <header className="space-y-2 mb-6">
        {/* R7 amendment v2 § 5: shared ScoutPageHeader. */}
        {scoutId && (
          <ScoutPageHeader scoutId={scoutId} scout={scoutMeta} />
        )}
        <h1 className="h-page">Shortlist</h1>
      </header>

      {/* R6 § H.1: explainer card added at the top of Shortlist. Uses the
          canonical .hq-explainer chrome (post-R3 Tip card). */}
      <div className="hq-explainer">
        <div className="hq-explainer-label">Tip</div>
        <p className="hq-explainer-body">
          Edit any field in-line. Go back to Sourcing to add a new venue and
          advance. Select the venues you want to advance to Review and click
          Continue — venue overviews are then generated.
        </p>
      </div>

      {/* R6 amendment v1 § 6 + R7 § C → R7 amendment v1 § 3: counter row
          right-aligned + text-base (mirrors Sourcing). */}
      <div className="mb-3 text-right text-base text-muted-foreground">
        <strong className="text-foreground font-bold">{pitchCount}</strong>{" "}
        marked for deck of{" "}
        <strong className="text-foreground font-bold">
          {venues.length}
        </strong>
      </div>

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
      <div className="tbl-wrap bg-surface-alt">
        <div className="overflow-x-auto scrollbar-thin">
          {/* R7 § A → R7 amendment v1 § 2: matrix tables use `.tbl--matrix`
              standalone (mirrors Sourcing). See SourcingReport for the
              composition rationale. */}
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
                sorted.map((v) => (
                  <VenueMatrixRow
                    key={v.id}
                    venue={v}
                    col1={{
                      label: "Pitch",
                      value: v.pitched,
                      onToggle: (next) => togglePitch(v.id, next),
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
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="actionbar">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link
            to={`/venue-scout/scouts/${scoutId}/sourcing/report`}
            className="crumb inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          {/* R6 § H.2: text-xs → text-base to match Review's action bar
              center text. */}
          <div className="flex-1 text-center text-base text-muted-foreground">
            <strong className="text-foreground">{pitchCount}</strong> marked for
            deck ·{" "}
            <strong className="text-foreground">2</strong> minimum to continue
          </div>
          <Button onClick={onContinue} disabled={!canContinue}>
            Continue · Review Selects →
          </Button>
        </div>
      </div>

    </div>
  );
}
