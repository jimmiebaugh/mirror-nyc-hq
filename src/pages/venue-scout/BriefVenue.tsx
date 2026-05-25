// Phase 4 Revision - Intake Step 2: Venue Details.
//
// Second step of the brief stepper. Gathers the venue-side fields the AI
// sourcing prompt needs (Target Neighborhoods, Venue Type, Ideal Features,
// Event Priorities, square-footage constraints). Back returns to /brief/event
// without persisting -- briefIntakeStore keeps the in-memory form. Submit
// Brief persists everything via toUpdate, then conditionally invokes
// vs-generate-brief-overview (Phase 4 Revision pass 3: only when the overview
// is missing or the brief fields that drive it changed since the last
// generation, gated on a hash stored in brief_data.overview_source_hash), and
// navigates to /brief/report. current_step is NOT touched here.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";
import { VSPageField } from "@/components/venue-scout/VSPageField";
import { Stepper } from "@/components/venue-scout/Stepper";
import { TagInput } from "@/components/venue-scout/TagInput";
import { ChipMultiSelect } from "@/components/venue-scout/ChipMultiSelect";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { useCityIdForName } from "@/lib/hq/lookups";
import {
  buildOverviewStub,
  computeOverviewSourceHash,
  fromScout,
  toUpdate,
  type BriefFormState,
  type PriorityCost,
  type PriorityLocation,
} from "@/lib/venue-scout/briefForm";
import { briefIntake } from "@/lib/venue-scout/briefIntakeStore";
import type { Database } from "@/integrations/supabase/types";

type VsScoutRow = Database["public"]["Tables"]["vs_scouts"]["Row"];

const SCOUT_SELECT =
  "id, client_name, event_name, live_dates, city, budget, event_overview, brief_data, current_step, archived_at, name, status, project_id, sheet_storage_path, derived_columns, generated_decks, deck_order, last_touched_at, created_at, created_by, updated_at, updated_by";

// Square-footage sliders run 0-10000 in 500 sq ft steps. Position 0 stores
// null ("TBD" / "Any"); for the Range max, position 10000 stores null ("no
// ceiling" / "10,000+").
const SQ_FT_MAX = 10000;
const SQ_FT_STEP = 500;

export default function BriefVenue() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [scout, setScout] = useState<VsScoutRow | null>(null);
  const [initial, setInitial] = useState<BriefFormState | null>(null);
  const [form, setForm] = useState<BriefFormState | null>(null);
  // false = idle. "submitting" = persisting the brief. "generating" = the
  // conditional vs-generate-brief-overview call is in flight (two-stage
  // spinner; the second stage only appears when a regen is actually needed).
  const [submitting, setSubmitting] = useState<
    false | "submitting" | "generating"
  >(false);

  useEffect(() => {
    if (!scoutId) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("vs_scouts")
        .select(SCOUT_SELECT)
        .eq("id", scoutId)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast({
          title: "Could not load scout",
          description: error?.message ?? "Scout not found",
          variant: "destructive",
        });
        return;
      }
      setScout(data as VsScoutRow);
      const cached = briefIntake.get(scoutId);
      if (cached) {
        setForm(cached.form);
        setInitial(cached.initial);
      } else {
        const f = fromScout(data as VsScoutRow);
        briefIntake.seed(scoutId, f);
        setForm(f);
        setInitial(f);
      }
    })();
    return () => {
      active = false;
    };
  }, [scoutId]);

  const dirty =
    !!initial && !!form && JSON.stringify(toUpdate(initial)) !== JSON.stringify(toUpdate(form));

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Phase 5.12.9: resolve form.city -> canonical cities.id so the
  // target_neighborhoods picker can parent-scope. Hook lives ABOVE the
  // early return below (design-system § 12 rule 2). Null-safe input keeps
  // the hook ordering stable while the scout row is loading.
  const cityId = useCityIdForName(form?.city ?? null);

  if (!scout || !form || !initial || !scoutId) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const isArchived = scout.archived_at !== null;
  const invalid = !form.city.trim();

  const patch = (partial: Partial<BriefFormState>) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, ...partial };
      briefIntake.setForm(scoutId, next);
      return next;
    });
  };
  const update = <K extends keyof BriefFormState>(k: K, v: BriefFormState[K]) =>
    patch({ [k]: v } as Pick<BriefFormState, K>);

  const goBack = () => navigate(`/venue-scout/scouts/${scout.id}/brief/event`);

  // Submit Brief: persist the form, then conditionally (re)generate the Event
  // Overview. The brief itself always persists; the overview regenerates only
  // when it's missing, has no recorded source hash, or the hash no longer
  // matches the brief fields that drive it.
  const requestSubmit = async () => {
    if (submitting) return;
    if (invalid) {
      toast({ title: "City is required", variant: "destructive" });
      return;
    }
    setSubmitting("submitting");

    const { error } = await supabase
      .from("vs_scouts")
      .update({
        ...toUpdate(form),
        last_touched_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", scout.id);
    if (error) {
      setSubmitting(false);
      toast({
        title: "Could not submit brief",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    // Decide whether the persisted overview is stale.
    const newHash = await computeOverviewSourceHash(form);
    const existingHash =
      typeof form.brief_data.overview_source_hash === "string"
        ? form.brief_data.overview_source_hash
        : null;
    const needGen =
      form.event_overview.trim() === "" ||
      existingHash === null ||
      existingHash !== newHash;

    let nextForm = form;

    if (needGen) {
      setSubmitting("generating");
      const { data, error: fnError } = await supabase.functions.invoke(
        "vs-generate-brief-overview",
        { body: { scout_id: scout.id } },
      );
      const responseError =
        fnError?.message ??
        (data as { error?: string } | null)?.error ??
        null;
      if (responseError) {
        // The function never produced an overview. Persist a client-side stub
        // with the freshly-computed hash so the next Submit Brief doesn't loop
        // on the same unchanged fields; the producer can retry via the
        // Regenerate link on the report.
        const stub = buildOverviewStub(form);
        nextForm = {
          ...form,
          event_overview: stub,
          brief_data: { ...form.brief_data, overview_source_hash: newHash },
        };
        const { error: stubErr } = await supabase
          .from("vs_scouts")
          .update({
            ...toUpdate(nextForm),
            last_touched_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
          })
          .eq("id", scout.id);
        if (stubErr) {
          console.warn(
            `[BriefVenue] scout=${scout.id} stub persist failed: ${stubErr.message}`,
          );
        }
        toast({
          title: "Overview generation failed",
          description: "Filled a basic overview you can edit on the report.",
          variant: "destructive",
        });
      } else {
        // The function persisted event_overview + overview_source_hash
        // atomically. Sync local state with what it returned.
        const overview =
          typeof (data as { event_overview?: unknown } | null)
            ?.event_overview === "string"
            ? (data as { event_overview: string }).event_overview
            : "";
        const returnedHash =
          typeof (data as { overview_source_hash?: unknown } | null)
            ?.overview_source_hash === "string"
            ? (data as { overview_source_hash: string }).overview_source_hash
            : newHash;
        nextForm = {
          ...form,
          event_overview: overview,
          brief_data: {
            ...form.brief_data,
            overview_source_hash: returnedHash,
          },
        };
      }
    }

    briefIntake.commit(scoutId, nextForm);
    setForm(nextForm);
    setInitial(nextForm);
    setSubmitting(false);
    navigate(`/venue-scout/scouts/${scout.id}/brief/report`);
  };

  // Square-footage slider <-> form-value mapping. Round 4 amendment v2 § D
  // retired the sq_ft_min/sq_ft_max range pair; sq_ft_minimum is the sole
  // intake control now.
  const minPos = form.sq_ft_minimum ?? 0;
  const minLabel =
    form.sq_ft_minimum === null
      ? "Any"
      : `${form.sq_ft_minimum.toLocaleString()} sq ft`;

  // Phase 5.12.14.3 Round 4 § 7.B: outer drops `mx-auto max-w-3xl` and goes
  // full-width inside the AppShell chrome. `stack-6` (24px gap) replaces the
  // legacy `space-y-6` so vertical rhythm matches BriefReport + BriefEvent.
  return (
    <div className="stack-6 pb-32">
      <header className="space-y-2">
        {/* R7 amendment v2 § 5: shared ScoutPageHeader (crumb left, phase
            stepper centered, gear right). */}
        <ScoutPageHeader scoutId={scout.id} scout={scout} />
        {/* Intake Stepper inline with Brief title — see BriefEvent for rationale. */}
        <div className="flex items-center gap-5">
          <h1 className="h-page">Brief →</h1>
          <Stepper active={2} />
        </div>
      </header>

      {isArchived && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          This scout is archived. Restore it from the Venue Scout index to edit the brief.
        </div>
      )}

      {/* Phase 5.12.14.3 Round 4 amendment: VS card-canon. Outer "Venue" card
          hosts one nested Details card with five grid rows. Sub-section
          eyebrows + section wrappers retired; .card-headbar + .h-card chrome
          replaces them. Strict checkbox folded into the Target Neighborhoods
          cell. Vibe + Aesthetic migrated from BriefEvent (state shape
          unchanged -- brief_data is flat jsonb). Min. Square Footage now
          renders before Sq. Footage Range. */}
      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">Venue</h2>
        </div>
        <div className="card-pad">

          <section className="card">
            <div className="card-headbar">
              <h3 className="h-card">Details</h3>
            </div>
            <div className="card-pad space-y-6">

              {/* Row 1 (3-col): City | Neighborhood(s) + Strict-in-label
                  composite | Expected Guest Count.

                  R6 amendment v1 § 1: in-label composite restored. The
                  nested-<label> HTML bug is fixed at the VSPageField
                  primitive level — composite ReactNode labels now render
                  inside a <div> wrapper instead of <Label>, so the
                  click-on-text-toggles-checkbox bug doesn't re-appear. The
                  inner Checkbox's own <Label htmlFor> keeps explicit
                  single-association for the checkbox toggle. */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <VSPageField label="City" required>
                  <RecordCombobox
                    source={{ kind: "lookup", table: "cities" }}
                    value={form.city || null}
                    onChange={(v) =>
                      // Phase 5.12.9: city change clears target_neighborhoods
                      // (prior picks may not exist under the new city).
                      patch({ city: v ?? "", target_neighborhoods: [] })
                    }
                    entityLabel="city"
                    disabled={isArchived}
                  />
                </VSPageField>
                <VSPageField
                  label={
                    <span className="flex items-center gap-2">
                      <span>Neighborhood(s)</span>
                      <span className="ml-2 inline-flex items-center gap-1.5 normal-case font-normal tracking-normal">
                        <Checkbox
                          id="strict_neighborhoods_only"
                          checked={form.strict_neighborhoods_only}
                          onCheckedChange={(c) =>
                            update("strict_neighborhoods_only", c === true)
                          }
                          disabled={isArchived}
                        />
                        <Label
                          htmlFor="strict_neighborhoods_only"
                          className="text-xs text-muted-foreground"
                        >
                          Strict?
                        </Label>
                      </span>
                    </span>
                  }
                >
                  <RecordCombobox
                    multi
                    multiValue={form.target_neighborhoods}
                    onMultiChange={(v) => update("target_neighborhoods", v)}
                    source={{
                      kind: "lookup",
                      table: "neighborhoods",
                      parentScopeId: cityId,
                      parentScopeLabel: form.city || null,
                      parentScopeLabelKey: "City",
                    }}
                    entityLabel="neighborhood"
                    placeholder={cityId ? "Pick neighborhoods" : "Pick a city first"}
                    disabled={isArchived || !cityId}
                  />
                </VSPageField>
                <VSPageField label="Expected Guest Count">
                  <Input
                    inputMode="numeric"
                    value={form.expected_guest_count}
                    onChange={(e) => update("expected_guest_count", e.target.value)}
                    placeholder="e.g. 150"
                    disabled={isArchived}
                  />
                </VSPageField>
              </div>

              {/* Row 2: Venue Type full-width */}
              <div>
                <VSPageField label="Venue Type">
                  <ChipMultiSelect
                    value={form.venue_types}
                    onChange={(v) => update("venue_types", v)}
                    disabled={isArchived}
                  />
                </VSPageField>
              </div>

              {/* Row 3: Min. Square Footage full-width (Sq. Footage Range field
                  retired in Round 4 amendment v2 § D). */}
              <div>
                <VSPageField label="Min. Square Footage">
                  <div className="pt-2">
                    <Slider
                      value={[minPos]}
                      min={0}
                      max={SQ_FT_MAX}
                      step={SQ_FT_STEP}
                      onValueChange={([v]) =>
                        update("sq_ft_minimum", v === 0 ? null : v)
                      }
                      disabled={isArchived}
                    />
                    <p className="mt-2 font-mono text-sm font-bold text-foreground">
                      {minLabel}
                    </p>
                  </div>
                </VSPageField>
              </div>

              {/* Row 4: Ideal Features | Vibe + Aesthetic (migrated from BriefEvent;
                  binds to the same form.vibe_aesthetic flat key). */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <VSPageField label="Ideal Features">
                  <TagInput
                    value={form.ideal_features}
                    onChange={(v) => update("ideal_features", v)}
                    placeholder="catering kitchen, parking, projection mapping…"
                    disabled={isArchived}
                  />
                </VSPageField>
                <VSPageField label="Vibe + Aesthetic">
                  <TagInput
                    value={form.vibe_aesthetic}
                    onChange={(v) => update("vibe_aesthetic", v)}
                    placeholder="e.g. Warm, Premium, then Enter"
                    disabled={isArchived}
                  />
                </VSPageField>
              </div>

              {/* Row 5: Location Priority | Cost Priority (literal "(optional)"
                  suffix in label text per amendment). */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <VSPageField label="Location Priority (optional)">
                  <ToggleGroup
                    type="single"
                    value={form.priority_location ?? ""}
                    onValueChange={(v) =>
                      update(
                        "priority_location",
                        v ? (v as PriorityLocation) : null,
                      )
                    }
                    disabled={isArchived}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="high_foot_traffic">
                      High Foot Traffic
                    </ToggleGroupItem>
                    <ToggleGroupItem value="intimate_destination">
                      Intimate / Destination
                    </ToggleGroupItem>
                  </ToggleGroup>
                </VSPageField>
                <VSPageField label="Cost Priority (optional)">
                  <ToggleGroup
                    type="single"
                    value={form.priority_cost ?? ""}
                    onValueChange={(v) =>
                      update("priority_cost", v ? (v as PriorityCost) : null)
                    }
                    disabled={isArchived}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="lower_cost">
                      Lower Venue Costs
                    </ToggleGroupItem>
                    <ToggleGroupItem value="premium">Premium Venue</ToggleGroupItem>
                  </ToggleGroup>
                </VSPageField>
              </div>

            </div>
          </section>

        </div>
      </section>

      {/* ---- Sticky footer ---- */}
      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Button variant="ghost" onClick={goBack}>
            ← Back
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-warn">
                Unsaved changes
              </span>
            )}
            <Button
              onClick={requestSubmit}
              disabled={!!submitting || invalid || isArchived}
            >
              {submitting === "generating"
                ? "Generating overview…"
                : submitting === "submitting"
                  ? "Submitting…"
                  : "Submit Brief"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

