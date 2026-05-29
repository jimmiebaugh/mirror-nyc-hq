import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { Stepper } from "@/components/ui/Stepper";
import { TagInput } from "@/components/talent-scout/TagInput";
import { CriterionCard } from "@/components/talent-scout/CriterionCard";
import { TS_WIZARD_STEPS, wizard, type Criterion } from "@/lib/talent-scout/wizardStore";
import { TIER_META, COMPETITOR_BONUS_POINTS } from "@/lib/talent-scout/scorecard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Phase 3.10: stable sort that puts criteria in tier-asc, weight-desc order.
// Used after every AI pass (initial generate + refinement) so each tier reads
// highest-points criterion first.
function sortByTierAndWeight(cs: Criterion[]): Criterion[] {
  return [...cs].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (Number(b.weight) || 0) - (Number(a.weight) || 0);
  });
}

export default function NewRoleScorecard() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<Criterion[]>(wizard.get().criteria ?? []);
  const [loading, setLoading] = useState(criteria.length === 0);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  // Phase 3.10: dirty = user has touched the scorecard since the last AI pass
  // (initial generate or refinement). When dirty, the bottom button reads
  // "Process Scorecard" and runs ts-refine-scorecard. When clean, it reads
  // "Lock scorecard" and creates the role.
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const ranOnce = useRef(false);

  useEffect(() => {
    const s = wizard.get();
    if (!s.step1 || !s.step2) {
      navigate("/talent-scout/new/details", { replace: true });
      return;
    }
    if (criteria.length === 0 && !ranOnce.current) {
      ranOnce.current = true;
      void generate(false);
    }
    // Phase 3.7.5: seed the role's competitor list from the global default
    // (Settings → Global Competitor List). Only fires when the field is
    // still empty so we don't clobber a user's manual edits if they've
    // already typed something in.
    (async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("talent_scout_competitor_list")
        .limit(1)
        .maybeSingle();
      const seed = (data?.talent_scout_competitor_list ?? []) as string[];
      if (seed.length > 0) {
        setCompetitors((current) => (current.length === 0 ? seed : current));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async (preserveManual: boolean) => {
    const s = wizard.get();
    if (!s.step1) return;
    setLoading(true);
    setError(null);
    const manual = preserveManual ? criteria.filter((c) => c.is_manual) : [];
    const { data, error: invokeErr } = await supabase.functions.invoke("ts-generate-scorecard", {
      body: {
        role_title: s.step1.title,
        jd: s.step1.job_description,
        hiring_priorities: s.step1.hiring_priorities,
        location: s.step1.location,
        employment_type: s.step1.type,
        comp: s.step1.compensation,
      },
    });
    setLoading(false);

    // The Supabase JS SDK throws FunctionsHttpError with a generic message for
    // non-2xx responses; the real error is in invokeErr.context (the Response).
    // Dig it out so the toast shows the actual cause, not "non-2xx status code".
    let errMsg = (data as { error?: string })?.error ?? null;
    if (!errMsg && invokeErr) {
      errMsg = invokeErr.message;
      const ctx = (invokeErr as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.clone().json();
          if (body?.error) errMsg = `${ctx.status}: ${body.error}`;
        } catch {
          try {
            const text = await ctx.clone().text();
            if (text) errMsg = `${ctx.status}: ${text.slice(0, 300)}`;
          } catch {
            /* swallow */
          }
        }
      }
    }
    if (errMsg) {
      setError(errMsg);
      console.error("ts-generate-scorecard failed:", errMsg, invokeErr);
      toast({ title: "Couldn't generate scorecard", description: errMsg, variant: "destructive" });
      return;
    }
    const ai: Criterion[] = (((data as { criteria?: Criterion[] })?.criteria ?? []) as Criterion[]).map((c) => ({
      ...c,
      is_manual: false,
    }));
    const merged = sortByTierAndWeight([...ai, ...manual]);
    setCriteria(merged);
    wizard.setCriteria(merged);
    // Initial generate or full regen counts as a clean AI pass — clear dirty.
    setDirty(false);
  };

  // Phase 3.10: refinement pass. Sends current criteria through Claude with
  // instructions to retain every user-provided concept while standardizing
  // name + describer to the shape downstream evals expect. Failure-safe: on
  // error, the user's edits stay intact and they can try again or lock as-is.
  const process = async () => {
    const s = wizard.get();
    if (!s.step1) return;
    if (criteria.length === 0) return;
    setRefining(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke("ts-refine-scorecard", {
      body: {
        role_title: s.step1.title,
        jd: s.step1.job_description,
        hiring_priorities: s.step1.hiring_priorities,
        location: s.step1.location,
        employment_type: s.step1.type,
        comp: s.step1.compensation,
        criteria,
      },
    });
    setRefining(false);

    let errMsg = (data as { error?: string })?.error ?? null;
    if (!errMsg && invokeErr) {
      errMsg = invokeErr.message;
      const ctx = (invokeErr as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.clone().json();
          if (body?.error) errMsg = `${ctx.status}: ${body.error}`;
        } catch {
          try {
            const text = await ctx.clone().text();
            if (text) errMsg = `${ctx.status}: ${text.slice(0, 300)}`;
          } catch {
            /* swallow */
          }
        }
      }
    }
    if (errMsg) {
      console.error("ts-refine-scorecard failed:", errMsg, invokeErr);
      toast({ title: "Couldn't refine scorecard", description: errMsg, variant: "destructive" });
      return;
    }
    const refinedRaw = ((data as { criteria?: Criterion[] })?.criteria ?? []) as Criterion[];
    const removed = (data as { removed_count?: number })?.removed_count ?? 0;
    // Edge function pre-filters dead criteria (weight=0 or empty name+describer)
    // so refined.length === criteria.length - removed. Sanity check: anything
    // else is a model output mismatch.
    if (refinedRaw.length !== criteria.length - removed) {
      toast({
        title: "Refinement returned wrong shape",
        description: `expected ${criteria.length - removed} criteria, got ${refinedRaw.length}`,
        variant: "destructive",
      });
      return;
    }
    // Re-sort each tier highest-weight first (per spec: "if the user changed
    // point values, each tier should be re-organized from highest point
    // criteria to lowest"). Idempotent if weights didn't change.
    const refined = sortByTierAndWeight(refinedRaw);
    setCriteria(refined);
    wizard.setCriteria(refined);
    setDirty(false);
    const removedNote =
      removed > 0
        ? ` · ${removed} empty / zero-point criteri${removed === 1 ? "on" : "a"} removed`
        : "";
    toast({
      title: "Scorecard refined",
      description: `Review the updated criteria, then lock or edit further${removedNote}.`,
    });
  };

  const update = (idx: number, patch: Partial<Criterion>) => {
    setCriteria((prev) => {
      const next = prev.map((c, i) => (i === idx ? { ...c, ...patch } : c));
      wizard.setCriteria(next);
      return next;
    });
    setDirty(true);
  };

  const remove = (idx: number) => {
    setCriteria((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      wizard.setCriteria(next);
      return next;
    });
    setDirty(true);
  };

  const addManual = (tier: 1 | 2 | 3) => {
    setCriteria((prev) => {
      const next = [
        ...prev,
        {
          name: "New criterion",
          tier,
          weight: 5,
          is_disqualifier: false,
          full_points_rubric: "Full points: …",
          partial_points_rubric: "Partial points: …",
          is_manual: true,
        } as Criterion,
      ];
      wizard.setCriteria(next);
      return next;
    });
    setDirty(true);
  };

  const total = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const onApprove = async () => {
    if (total !== 100) {
      if (!window.confirm(`Total weights = ${total}, not 100. Approve anyway?`)) return;
    }
    const s = wizard.get();
    if (!s.step1 || !s.step2) return;
    setSaving(true);

    const insertPayload = {
      title: s.step1.title,
      job_description: s.step1.job_description,
      location: s.step1.location,
      type: s.step1.type,
      compensation: s.step1.compensation,
      start_date: null as string | null, // free-form on step1; HQ schema is `date`. Skip storing freeform "ASAP" etc. for now.
      hiring_priorities: s.step1.hiring_priorities,
      hiring_manager_id: s.step1.hiring_manager_id,
      auto_rejection_threshold: s.step1.auto_rejection_threshold,
      email_keywords: s.step2.email_keywords,
      email_search_start_date: s.step2.email_search_start_date,
      auto_pull_schedule: s.step2.auto_pull_schedule,
      scorecard: criteria,
      competitor_bonus: { competitors, bonus_points: COMPETITOR_BONUS_POINTS },
      status: "open" as const,
    };

    const { data: role, error: roleErr } = await supabase
      .from("ts_roles")
      .insert(insertPayload)
      .select("id")
      .single();

    setSaving(false);

    if (roleErr || !role) {
      toast({
        title: "Couldn't create role",
        description: roleErr?.message ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }

    wizard.reset();
    toast({ title: "Role created", description: "Scorecard locked." });
    navigate(`/talent-scout/roles/${role.id}`);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="eyebrow mb-2">New Role</div>
        <Stepper steps={TS_WIZARD_STEPS} active={3} />
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div>
            <div className="text-xl font-semibold">Generating scorecard…</div>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Analyzing your job description and hiring priorities to build a weighted, tiered scorecard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error && criteria.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="eyebrow mb-2">New Role</div>
        <Stepper steps={TS_WIZARD_STEPS} active={3} />
        <section className="card">
          <div className="card-pad space-y-4 text-center">
            <p className="text-sm">⚠ {error}</p>
            <div className="flex justify-center gap-3">
              <Button variant="ghost" className="text-primary" onClick={() => navigate("/talent-scout/new/search")}>
                Back
              </Button>
              <Button onClick={() => generate(false)}>Try again</Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-32">
      <div className="eyebrow mb-2">New Role</div>
      <Stepper steps={TS_WIZARD_STEPS} active={3} />

      <header className="space-y-2">
        <h1 className="h-page">Review scorecard</h1>
      </header>

      <div className="hq-explainer">
        <div className="hq-explainer-label">Tip</div>
        <p className="hq-explainer-body">Mark any Tier 1 criteria as disqualifying to reject candidates that are missing it. Manually add a criterion within any tier - manual adds persist through regeneration. Make any edits, including point adjustments, and process the scorecard and lock in to begin evaluating candidates.</p>
      </div>

      {dirty && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-xs text-warn">
          <span className="font-bold">●</span> Edits pending. Run <strong>Process scorecard</strong> to refine before locking. Your edits will be retained and phrasing standardized for evaluations.
        </div>
      )}

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Scorecard</span>
          <Button
            className="bg-primary text-white hover:bg-primary-hover"
            size="sm"
            onClick={() => generate(true)}
            title="Regenerates AI criteria · keeps your manual additions"
            disabled={refining}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Regenerate
          </Button>
        </div>
        <div className={cn("card-pad space-y-6", refining && "pointer-events-none opacity-60 transition-opacity")}>
          {([1, 2, 3] as const).map((tier) => {
            const items = criteria.map((c, i) => ({ c, i })).filter(({ c }) => c.tier === tier);
            const subtotal = items.reduce((s, { c }) => s + (Number(c.weight) || 0), 0);
            const meta = TIER_META[tier];
            return (
              <div key={tier}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={cn("pill pill-sm", meta.token)}>
                      {meta.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{meta.subtitle}</span>
                  </div>
                  <span className="text-xs font-bold text-muted-foreground">{subtotal} / 100 pts</span>
                </div>
                <div className="space-y-2">
                  {items.map(({ c, i }) => (
                    <CriterionCard key={i} c={c} onChange={(p) => update(i, p)} onRemove={() => remove(i)} />
                  ))}
                  <button
                    type="button"
                    onClick={() => addManual(tier)}
                    className="w-full rounded-md border border-dashed border-border py-3 text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    + Add tier {tier} criterion
                  </button>
                </div>
                {tier < 3 && <div className="mt-6 border-t border-border" />}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Bonus: Competitor Experience</span>
          <span className="text-xs text-muted-foreground">Up to +{COMPETITOR_BONUS_POINTS} bonus points</span>
        </div>
        <div className="card-pad space-y-3">
          <p className="text-xs text-muted-foreground">
            Candidates with experience at any company below earn the competitor bonus.
            5 pts: 1 to 2 years · 10 pts: 3+ years · +2 pts: leadership role at competitor.
          </p>
          <TagInput value={competitors} onChange={setCompetitors} placeholder="Add competitor…" />
        </div>
      </section>

      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            className="btn btn-tertiary"
            onClick={() => navigate("/talent-scout/new/search")}
          >
            <IconArrowLeft className="ic" />
            Back
          </button>
          <div className="flex-1 text-center text-base text-muted-foreground">
            Total:{" "}
            <strong className={total === 100 ? "text-foreground" : "text-warn"}>
              {total} pts + {COMPETITOR_BONUS_POINTS} bonus
            </strong>
          </div>
          {dirty ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={process}
              disabled={refining || saving}
              title="Refine your edits through Claude before locking"
            >
              {refining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refining…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Process scorecard →
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onApprove}
              disabled={saving || refining}
            >
              {saving ? "Saving…" : "Approve & lock scorecard →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// CriterionCard extracted to src/components/talent-scout/CriterionCard.tsx
// (Phase 3.7.6) so RoleSettings can reuse the same row editor.
