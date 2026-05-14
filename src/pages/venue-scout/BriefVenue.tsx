// Phase 4 Revision - Intake Step 2: Venue Details.
//
// Second step of the brief stepper. Gathers the venue-side fields the AI
// sourcing prompt needs (Target Neighborhoods, Venue Type, Ideal Features,
// Event Priorities, square-footage constraints). Back returns to /brief/event
// without persisting -- briefIntakeStore keeps the in-memory form. Submit
// Brief persists everything via toUpdate and navigates to /brief/report,
// which fires the Event Overview generation on first arrival. current_step is
// NOT touched here.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";
import { Stepper } from "@/components/venue-scout/Stepper";
import { TagInput } from "@/components/venue-scout/TagInput";
import { ChipMultiSelect } from "@/components/venue-scout/ChipMultiSelect";
import {
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
  const [submitting, setSubmitting] = useState(false);

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

  const requestSubmit = async () => {
    if (submitting) return;
    if (invalid) {
      toast({ title: "City is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const payload = {
      ...toUpdate(form),
      last_touched_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    };
    const { error } = await supabase
      .from("vs_scouts")
      .update(payload)
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
    briefIntake.commit(scoutId, form);
    setInitial(form);
    navigate(`/venue-scout/scouts/${scout.id}/brief/report`);
  };

  // Square-footage slider <-> form-value mapping.
  const rangeLo = form.sq_ft_min ?? 0;
  const rangeHi = form.sq_ft_max ?? SQ_FT_MAX;
  const rangeLabel = `${
    form.sq_ft_min === null ? "TBD" : form.sq_ft_min.toLocaleString()
  } to ${
    form.sq_ft_max === null ? "10,000+" : form.sq_ft_max.toLocaleString()
  } sq ft`;
  const minPos = form.sq_ft_minimum ?? 0;
  const minLabel =
    form.sq_ft_minimum === null
      ? "Any"
      : `${form.sq_ft_minimum.toLocaleString()} sq ft`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <Link to="/venue-scout" className="crumb">
        ← Back to Venue Scout
      </Link>
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <h1 className="h-page">Venue Details</h1>
          <p className="text-sm text-muted-foreground">
            Tell us where the event lives and what kind of space we're hunting for.
          </p>
        </div>
        <ScoutSettingsLink scoutId={scout.id} />
      </header>
      <ScoutStepThroughNav scoutId={scout.id} scout={scout} />
      <Stepper active={2} />

      {isArchived && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This scout is archived. Restore it from the Venue Scout index to edit the brief.
        </div>
      )}

      <Card className="bg-surface-alt">
        <CardContent className="space-y-8 p-8">
          {/* ---- City + Expected Guest Count ---- */}
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="City" required>
              <Input
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="e.g. New York, NY"
                disabled={isArchived}
              />
            </Field>
            <Field label="Expected guest count">
              <Input
                inputMode="numeric"
                value={form.expected_guest_count}
                onChange={(e) => update("expected_guest_count", e.target.value)}
                placeholder="e.g. 150"
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Target Neighborhoods + strict toggle ---- */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                Target neighborhoods
              </Label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={form.strict_neighborhoods_only}
                  onCheckedChange={(c) =>
                    update("strict_neighborhoods_only", c === true)
                  }
                  disabled={isArchived}
                />
                Search strictly these neighborhoods only?
              </label>
            </div>
            <TagInput
              value={form.target_neighborhoods}
              onChange={(v) => update("target_neighborhoods", v)}
              placeholder="e.g. SoHo, then Enter"
              disabled={isArchived}
            />
          </section>

          {/* ---- Venue Type ---- */}
          <section className="space-y-4">
            <Field label="Venue type">
              <ChipMultiSelect
                value={form.venue_types}
                onChange={(v) => update("venue_types", v)}
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Square Footage Range + Minimum ---- */}
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Square footage range">
              <div className="pt-2">
                <Slider
                  value={[rangeLo, rangeHi]}
                  min={0}
                  max={SQ_FT_MAX}
                  step={SQ_FT_STEP}
                  onValueChange={([lo, hi]) =>
                    patch({
                      sq_ft_min: lo === 0 ? null : lo,
                      sq_ft_max: hi === SQ_FT_MAX ? null : hi,
                    })
                  }
                  disabled={isArchived}
                />
                <p className="mt-2 font-mono text-sm font-bold text-foreground">
                  {rangeLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Slide the ends to TBD / 10,000+ for an open range.
                </p>
              </div>
            </Field>
            <Field label="Minimum square footage">
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
                <p className="mt-1 text-xs text-muted-foreground">
                  Hard floor the search shouldn't go below.
                </p>
              </div>
            </Field>
          </section>

          {/* ---- Ideal Features ---- */}
          <section className="space-y-4">
            <Field label="Ideal features">
              <TagInput
                value={form.ideal_features}
                onChange={(v) => update("ideal_features", v)}
                placeholder="catering kitchen, parking, projection mapping…"
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Event Priorities ---- */}
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Event priority · location">
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
            </Field>
            <Field label="Event priority · cost">
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
            </Field>
          </section>
        </CardContent>
      </Card>

      {/* ---- Sticky footer ---- */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Button variant="ghost" onClick={goBack}>
            ← Back
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
                Unsaved changes
              </span>
            )}
            <Button
              onClick={requestSubmit}
              disabled={submitting || invalid || isArchived}
            >
              {submitting ? "Saving…" : "Submit Brief"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline Field -- matches the BriefEvent / NewScout page-form Field shape.
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
