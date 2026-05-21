import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
        <Stepper steps={TS_WIZARD_STEPS} active={3} />
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <p className="text-sm">⚠ {error}</p>
            <div className="flex justify-center gap-3">
              <Button variant="ghost" onClick={() => navigate("/talent-scout/new/search")}>
                ← Back
              </Button>
              <Button onClick={() => generate(false)}>Try again</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Stepper steps={TS_WIZARD_STEPS} active={3} />

      <div className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-[14px] font-mono uppercase tracking-widest text-primary">Talent Scout · New Role</div>
          <h1 className="h-page">Review scorecard</h1>
          <p className="text-sm text-muted-foreground">
            Generated from your JD. Edit weights, add criteria, then lock it in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => generate(true)} title="Regenerates AI criteria · keeps your manual additions">
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Regenerate
        </Button>
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-bold text-primary">✱</span> Manually-added criteria are tagged <span className="ml-1 inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">Manual</span> and persist through regenerate. After any edit, click <strong className="text-foreground">Process scorecard</strong> to refine your phrasing for evaluation use; then lock it in.
      </div>

      {dirty && (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-xs text-amber-200">
          <span className="font-bold text-amber-300">●</span> Edits pending. Run <strong>Process scorecard</strong> to refine before locking — Claude will retain every concept you added and standardize phrasing for downstream evaluations.
        </div>
      )}

      <div className={cn(refining && "pointer-events-none opacity-60 transition-opacity")}>
      {([1, 2, 3] as const).map((tier) => {
        const items = criteria.map((c, i) => ({ c, i })).filter(({ c }) => c.tier === tier);
        const subtotal = items.reduce((s, { c }) => s + (Number(c.weight) || 0), 0);
        const meta = TIER_META[tier];
        return (
          <div key={tier} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={cn("inline-flex items-center rounded-sm border px-2.5 py-1 text-[13px] font-mono font-bold uppercase tracking-wider", meta.color)}>
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
          </div>
        );
      })}
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Source's tier-badge--bonus uses coral primary (#ef5b5b),
                  not purple. Aligned in Phase 3.5b. */}
              <span className="inline-flex items-center rounded-sm border border-primary/40 bg-primary/15 px-2.5 py-1 text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
                Bonus — Competitor Experience
              </span>
              <span className="text-xs text-muted-foreground">Up to +{COMPETITOR_BONUS_POINTS} bonus points</span>
            </div>
            <span className="text-xs font-bold text-muted-foreground">+{COMPETITOR_BONUS_POINTS} max</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Candidates with experience at any company below earn the competitor bonus.
            5 pts: 1–2 years · 10 pts: 3+ years · +2 pts: leadership role at competitor.
          </p>
          <TagInput value={competitors} onChange={setCompetitors} placeholder="Add competitor…" />
        </CardContent>
      </Card>

      {/* Spacer so the floating bottom nav doesn't overlap the last criterion. */}
      <div className="h-16" />

      <div className="sticky bottom-0 -mx-4 border-t-2 border-primary/40 bg-primary/10 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-primary/15 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate("/talent-scout/new/search")}>
            ← Back
          </Button>
          <div className="flex items-center gap-4">
            <span className="text-lg text-muted-foreground">
              Total:{" "}
              <strong className={total === 100 ? "text-foreground" : "text-amber-400"}>
                {total} pts + {COMPETITOR_BONUS_POINTS} bonus
              </strong>
            </span>
            {dirty ? (
              <Button onClick={process} disabled={refining || saving} size="lg" title="Refine your edits through Claude before locking">
                {refining ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refining…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Process scorecard →
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={onApprove} disabled={saving || refining} size="lg">
                {saving ? "Saving…" : "Approve & lock scorecard →"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// CriterionCard extracted to src/components/talent-scout/CriterionCard.tsx
// (Phase 3.7.6) so RoleSettings can reuse the same row editor.
