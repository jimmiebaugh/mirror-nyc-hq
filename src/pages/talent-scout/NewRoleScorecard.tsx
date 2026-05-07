import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Stepper } from "@/components/talent-scout/Stepper";
import { TagInput } from "@/components/talent-scout/TagInput";
import { wizard, type Criterion } from "@/lib/talent-scout/wizardStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Tier colors aligned with CandidateDetail / source's tier-badge--{1,2,3}.
// T1 red-500, T2 amber-500, T3 green-400 (= source's #4ade80).
const TIER_META = {
  1: { label: "Tier 1 — Must-Haves", subtitle: "Disqualifying if absent", color: "bg-red-500/10 border-red-500/30 text-red-500" },
  2: { label: "Tier 2 — Strong Differentiators", subtitle: "Meaningfully elevates a candidate", color: "bg-amber-500/10 border-amber-500/30 text-amber-500" },
  3: { label: "Tier 3 — Nice-to-Haves", subtitle: "Bonus value · not required", color: "bg-green-400/10 border-green-400/30 text-green-400" },
} as const;

const COMPETITOR_BONUS_POINTS = 12;

export default function NewRoleScorecard() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<Criterion[]>(wizard.get().criteria ?? []);
  const [loading, setLoading] = useState(criteria.length === 0);
  const [saving, setSaving] = useState(false);
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
    const merged = [...ai, ...manual];
    setCriteria(merged);
    wizard.setCriteria(merged);
  };

  const update = (idx: number, patch: Partial<Criterion>) => {
    setCriteria((prev) => {
      const next = prev.map((c, i) => (i === idx ? { ...c, ...patch } : c));
      wizard.setCriteria(next);
      return next;
    });
  };

  const remove = (idx: number) => {
    setCriteria((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      wizard.setCriteria(next);
      return next;
    });
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
        <Stepper active={3} />
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
        <Stepper active={3} />
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
      <Stepper active={3} />

      <div className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-widest text-primary">Talent Scout · New Role</div>
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
        <span className="font-bold text-primary">✱</span> Manually-added criteria are tagged <span className="ml-1 inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">Manual</span> and persist through regenerate.
      </div>

      {([1, 2, 3] as const).map((tier) => {
        const items = criteria.map((c, i) => ({ c, i })).filter(({ c }) => c.tier === tier);
        const subtotal = items.reduce((s, { c }) => s + (Number(c.weight) || 0), 0);
        const meta = TIER_META[tier];
        return (
          <div key={tier} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={cn("inline-flex items-center rounded-sm border px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider", meta.color)}>
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
                className="w-full rounded-md border border-dashed border-border py-3 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                + Add tier {tier} criterion
              </button>
            </div>
          </div>
        );
      })}

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Source's tier-badge--bonus uses coral primary (#ef5b5b),
                  not purple. Aligned in Phase 3.5b. */}
              <span className="inline-flex items-center rounded-sm border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-primary">
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
            <Button onClick={onApprove} disabled={saving} size="lg">
              {saving ? "Saving…" : "Approve & lock scorecard →"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CriterionCard({
  c,
  onChange,
  onRemove,
}: {
  c: Criterion;
  onChange: (p: Partial<Criterion>) => void;
  onRemove: () => void;
}) {
  const points = Number(c.weight) || 0;
  return (
    <div
      className={cn(
        "grid items-start gap-4 rounded-md border border-border bg-card p-4",
        c.is_manual && "border-l-2 border-l-primary",
      )}
      style={{ gridTemplateColumns: "1fr 90px auto auto" }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <input
            value={c.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full bg-transparent text-sm font-semibold outline-none focus:border-b focus:border-primary"
          />
          {c.is_manual && (
            <span className="inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
              Manual
            </span>
          )}
        </div>
        <div className="space-y-1">
          <input
            value={c.full_points_rubric}
            onChange={(e) => onChange({ full_points_rubric: e.target.value })}
            placeholder="Full points criteria"
            className="w-full bg-transparent text-xs text-muted-foreground outline-none focus:border-b focus:border-primary"
          />
          <input
            value={c.partial_points_rubric}
            onChange={(e) => onChange({ partial_points_rubric: e.target.value })}
            placeholder="Partial points criteria"
            className="w-full bg-transparent text-xs text-muted-foreground outline-none focus:border-b focus:border-primary"
          />
        </div>
      </div>

      <Input
        type="number"
        min={0}
        value={c.weight}
        onChange={(e) => onChange({ weight: Number(e.target.value) || 0 })}
        className="h-9 text-center font-bold"
      />

      {c.tier === 1 ? (
        <label className="flex max-w-[180px] cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
          <Checkbox
            checked={c.is_disqualifier}
            onCheckedChange={(v) => onChange({ is_disqualifier: !!v })}
          />
          Disqualify if missing
        </label>
      ) : (
        <div />
      )}

      <div className="flex items-center gap-3">
        <div className="text-base font-bold">{points} pts</div>
        {c.is_manual && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground"
            title="Remove"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
