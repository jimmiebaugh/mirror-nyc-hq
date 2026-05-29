import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TagInput } from "@/components/talent-scout/TagInput";
import { HQFormField } from "@/components/hq/HQFormField";
import { CriterionCard } from "@/components/talent-scout/CriterionCard";
import { TIER_META, COMPETITOR_BONUS_POINTS } from "@/lib/talent-scout/scorecard";
import type { Criterion } from "@/lib/talent-scout/wizardStore";
import { DEFAULT_EVAL_PROMPT } from "@/lib/talent-scout/defaultEvalPrompt";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type RoleRow = Database["public"]["Tables"]["ts_roles"]["Row"];
type RoleUpdate = Database["public"]["Tables"]["ts_roles"]["Update"];
type AutoPullSchedule = Database["public"]["Enums"]["ts_role_auto_pull_schedule"];

type AdminUser = { id: string; email: string; full_name: string | null };

type FormState = {
  title: string;
  job_description: string;
  location: string;
  type: string;
  compensation: string;
  hiring_manager_id: string | null;
  hiring_priorities: string;
  auto_rejection_threshold: number;
  email_keywords: string[];
  email_search_start_date: string;
  auto_pull_schedule: AutoPullSchedule;
  competitors: string[];
  evaluation_prompt: string;
  scorecard: Criterion[];
};

const SCHEDULE_OPTIONS: { value: AutoPullSchedule; label: string }[] = [
  { value: "off", label: "Off (manual)" },
  { value: "daily", label: "Daily" },
  { value: "every_3_days", label: "Every 3 days" },
  { value: "weekly", label: "Weekly" },
];

function fromRole(r: RoleRow): FormState {
  // deno-lint-ignore-file no-explicit-any
  const competitorBonus = (r.competitor_bonus as { competitors?: string[] } | null) ?? null;
  const scorecard = (r.scorecard as unknown as Criterion[] | null) ?? [];
  return {
    title: r.title ?? "",
    job_description: r.job_description ?? "",
    location: r.location ?? "",
    type: r.type ?? "",
    compensation: r.compensation ?? "",
    hiring_manager_id: r.hiring_manager_id ?? null,
    hiring_priorities: r.hiring_priorities ?? "",
    auto_rejection_threshold: r.auto_rejection_threshold ?? 60,
    email_keywords: r.email_keywords ?? [],
    email_search_start_date: r.email_search_start_date ?? "",
    auto_pull_schedule: r.auto_pull_schedule ?? "off",
    competitors: competitorBonus?.competitors ?? [],
    evaluation_prompt: r.evaluation_prompt ?? DEFAULT_EVAL_PROMPT,
    scorecard: scorecard.map((c) => ({
      ...c,
      tier: (Number(c.tier) as 1 | 2 | 3),
    })),
  };
}

// Returns true when a JD / Additional Priorities / eval prompt / scorecard
// edit happened — these are the changes that force re-evaluation of the
// candidate pool. Other edits (title, location, keywords, etc.) save
// without prompting.
// Phase 3.7.6.9: hiring_priorities (Additional Priorities and Factors Not
// in JD) added — same re-eval implications as the JD itself.
function reEvalRelevantChanges(initial: FormState, current: FormState): {
  jd: boolean;
  priorities: boolean;
  prompt: boolean;
  scorecard: boolean;
} {
  return {
    jd: initial.job_description !== current.job_description,
    priorities: initial.hiring_priorities !== current.hiring_priorities,
    prompt: initial.evaluation_prompt !== current.evaluation_prompt,
    scorecard: JSON.stringify(initial.scorecard) !== JSON.stringify(current.scorecard),
  };
}

function isFormDirty(initial: FormState | null, current: FormState | null) {
  if (!initial || !current) return false;
  return JSON.stringify(initial) !== JSON.stringify(current);
}

// Phase 3.7.6.4: shared scorecard total for the header + footer readouts.
function scorecardTotal(criteria: Criterion[]): number {
  return criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
}

// Phase 3.10: stable sort for the post-refine re-sort (tier asc, weight desc
// within tier). Mirrors the wizard's helper.
function sortByTierAndWeight(cs: Criterion[]): Criterion[] {
  return [...cs].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (Number(b.weight) || 0) - (Number(a.weight) || 0);
  });
}

// "Total:" coral + value coloring; sits both in the Scorecard card header
// (right side of the title row) and at the bottom of ScorecardEditor.
// text-[14px] = +15% over the prior text-xs (12px) per Jimmie's spec.
function ScorecardTotalReadout({ total }: { total: number }) {
  return (
    <span className="text-[14px] font-bold whitespace-nowrap">
      <span className="text-primary">Total:</span>{" "}
      <span className={total === 100 ? "text-foreground" : "text-amber-400"}>
        {total} / 100
      </span>
    </span>
  );
}

export default function RoleSettings() {
  const { id } = useParams();
  const nav = useNavigate();
  const [role, setRole] = useState<RoleRow | null>(null);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  // Phase 3.10: tracks whether the user has edited the scorecard since the
  // last refine pass (or since the page loaded if no refine has run yet).
  // When true AND form.scorecard differs from initial.scorecard, the bottom-
  // bar action morphs from "Save changes" to "Process scorecard". Cleared on
  // every successful refine response. Cleared on initial load.
  const [scorecardEditedSinceRefine, setScorecardEditedSinceRefine] = useState(false);
  const [confirmReevalOpen, setConfirmReevalOpen] = useState(false);
  // What triggered the re-eval confirm — drives the dialog body copy.
  const [confirmReason, setConfirmReason] = useState<"jd" | "priorities" | "prompt" | "scorecard" | null>(null);

  // Phase 3.7.6.7: when a role has no competitor_bonus.competitors saved
  // yet (legacy role pre-Settings, or never customized), show the global
  // default list as a fallback so reviewers see something useful. Flag
  // state distinguishes "user hasn't touched this" from "user actively
  // cleared the list" — the caption only renders for the former.
  const [usingDefaultCompetitors, setUsingDefaultCompetitors] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [{ data: r }, { data: a }, { data: gs }] = await Promise.all([
        supabase.from("ts_roles").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("users")
          .select("id, email, full_name")
          .eq("permission_role", "admin")
          .eq("active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("global_settings")
          .select("talent_scout_competitor_list")
          .limit(1)
          .maybeSingle(),
      ]);
      if (!active) return;
      const globalList = (gs?.talent_scout_competitor_list ?? []) as string[];
      if (r) {
        setRole(r as RoleRow);
        const f = fromRole(r as RoleRow);
        // Empty role-level list → seed visually from the global default
        // so the user sees what'll be applied. Flag state so the UI can
        // surface a "Showing default competitors list" caption.
        if (f.competitors.length === 0 && globalList.length > 0) {
          f.competitors = globalList;
          setUsingDefaultCompetitors(true);
        }
        setForm(f);
        setInitial(f);
      }
      setAdmins((a ?? []) as AdminUser[]);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const dirty = isFormDirty(initial, form);

  // Phase 3.7.6.1: useBlocker requires the v6 data-router (createBrowserRouter),
  // which the HQ app isn't using — it's still on plain BrowserRouter. We
  // cover unsaved changes with two narrower hooks instead:
  //   - beforeunload (tab close / hard reload) → native browser dialog.
  //   - confirm() on the in-page Cancel/Back buttons.
  // Hard nav inside the app via direct URL bar / external Link clicks
  // won't trigger anything, but the buttons users actually use are
  // gated. Good enough until we migrate to data router.
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const pendingNavRef = useRef<string | null>(null);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const navigateOrConfirm = (target: string) => {
    if (dirty) {
      pendingNavRef.current = target;
      setConfirmLeaveOpen(true);
    } else {
      nav(target);
    }
  };

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  // Phase 3.7.6.2: confirmCopy useMemo MUST sit above the loading-gate
  // early return — otherwise it runs on the second render but not the
  // first (loading state), tripping React's "more hooks than previous
  // render" rule and unmounting the entire subtree (black screen).
  const confirmCopy = useMemo(() => {
    if (confirmReason === "jd") {
      return "Saving will update the job description for this role and will force re-evaluation of all candidates (including auto-rejected) and overwrite existing evaluations and statuses. Please confirm or cancel.";
    }
    if (confirmReason === "priorities") {
      return "Saving will update the additional priorities for this role and will force re-evaluation of all candidates (including auto-rejected) and overwrite existing evaluations and statuses. Please confirm or cancel.";
    }
    if (confirmReason === "prompt") {
      return "Editing the evaluation prompt will force re-evaluation of all (including auto-rejected) candidates and overwrite existing evaluations and statuses. Please confirm or cancel.";
    }
    return "Editing the scorecard will force re-evaluation of all (including auto-rejected) candidates and overwrite existing evaluations and statuses. Please confirm or cancel.";
  }, [confirmReason]);

  if (!role || !form || !initial) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // ---- Save flow ------------------------------------------------------
  // - Validate required fields
  // - If JD / prompt / scorecard changed → open confirm dialog before
  //   touching the DB. The dialog explains the re-eval consequence.
  // - On confirm (or when no triggering change happened) → write to
  //   ts_roles, then if any triggering change happened invoke
  //   ts-bulk-reevaluate with filter='not_manually_rejected'.

  const validate = (): string | null => {
    if (!form.title.trim()) return "Title is required.";
    if (!form.job_description.trim()) return "Job description is required.";
    if (!form.hiring_manager_id) return "Hiring manager is required.";
    if (form.scorecard.length === 0) return "Scorecard must have at least one criterion.";
    return null;
  };

  // Phase 3.10: refine the scorecard via Claude. Same edge function as the
  // wizard step-3 path. Drops dead criteria (weight=0 or empty name+describer)
  // server-side, refines name + describer for the rest, preserves all
  // scoring fields. Frontend re-sorts each tier by weight desc on success.
  // Failure-safe: on error the user's edits stay in form, they can try again
  // or hand-edit and save anyway.
  const runRefine = async () => {
    if (form.scorecard.length === 0) {
      toast({ title: "Scorecard is empty", variant: "destructive" });
      return;
    }
    setRefining(true);
    const { data, error: invokeErr } = await supabase.functions.invoke("ts-refine-scorecard", {
      body: {
        role_title: form.title,
        jd: form.job_description,
        hiring_priorities: form.hiring_priorities,
        location: form.location,
        employment_type: form.type,
        comp: form.compensation,
        criteria: form.scorecard,
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
    if (refinedRaw.length !== form.scorecard.length - removed) {
      toast({
        title: "Refinement returned wrong shape",
        description: `expected ${form.scorecard.length - removed} criteria, got ${refinedRaw.length}`,
        variant: "destructive",
      });
      return;
    }
    const refined = sortByTierAndWeight(refinedRaw);
    update("scorecard", refined);
    setScorecardEditedSinceRefine(false);
    const removedNote =
      removed > 0
        ? ` · ${removed} empty / zero-point criteri${removed === 1 ? "on" : "a"} removed`
        : "";
    toast({
      title: "Scorecard refined",
      description: `Review the updated criteria, then click Save to commit + trigger re-eval${removedNote}.`,
    });
  };

  const requestSave = () => {
    const err = validate();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    const changes = reEvalRelevantChanges(initial, form);
    if (changes.jd) setConfirmReason("jd");
    else if (changes.priorities) setConfirmReason("priorities");
    else if (changes.prompt) setConfirmReason("prompt");
    else if (changes.scorecard) setConfirmReason("scorecard");
    if (changes.jd || changes.priorities || changes.prompt || changes.scorecard) {
      setConfirmReevalOpen(true);
      return;
    }
    void persist();
  };

  const persist = async () => {
    setSaving(true);
    const changes = reEvalRelevantChanges(initial, form);
    const payload: RoleUpdate = {
      title: form.title,
      job_description: form.job_description,
      location: form.location || null,
      type: form.type || null,
      compensation: form.compensation || null,
      hiring_manager_id: form.hiring_manager_id,
      hiring_priorities: form.hiring_priorities || null,
      auto_rejection_threshold: form.auto_rejection_threshold,
      email_keywords: form.email_keywords,
      email_search_start_date: form.email_search_start_date || null,
      auto_pull_schedule: form.auto_pull_schedule,
      // jsonb shape preserves the existing bonus_points value if nothing
      // else has set it; we keep the canonical 12 either way.
      competitor_bonus: { competitors: form.competitors, bonus_points: COMPETITOR_BONUS_POINTS },
      // Empty string → null so the eval pipeline falls back to the system
      // default. Anything else is treated as a custom prompt.
      evaluation_prompt: form.evaluation_prompt.trim() === DEFAULT_EVAL_PROMPT.trim()
        ? null
        : (form.evaluation_prompt || null),
      // scorecard is the ts_roles jsonb column; narrow to the column's
      // generated Json type rather than any.
      scorecard: form.scorecard as RoleUpdate["scorecard"],
    };
    const { error } = await supabase.from("ts_roles").update(payload).eq("id", role.id);
    if (error) {
      setSaving(false);
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setInitial(form);
    setConfirmReevalOpen(false);

    // Kick off re-eval if a triggering field changed. We don't await —
    // ts-bulk-reevaluate is fire-and-forget; the role's reeval_status
    // surfaces progress on RoleDashboard.
    if (changes.jd || changes.priorities || changes.prompt || changes.scorecard) {
      const { error: rrErr } = await supabase.functions.invoke("ts-bulk-reevaluate", {
        body: { role_id: role.id, status_filter: "not_manually_rejected" },
      });
      if (rrErr) {
        toast({
          title: "Saved, but re-eval kickoff failed",
          description: rrErr.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Saved · re-evaluation started" });
      }
    } else {
      toast({ title: "Saved" });
    }
    setSaving(false);
  };

  const onCloseRole = async () => {
    const { error } = await supabase.from("ts_roles").update({ status: "closed" }).eq("id", role.id);
    if (error) {
      toast({ title: "Close failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role closed" });
    nav(`/talent-scout/roles/${role.id}`);
  };

  const onReopen = async () => {
    const { error } = await supabase.from("ts_roles").update({ status: "open" }).eq("id", role.id);
    if (error) {
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role reopened" });
    nav(`/talent-scout/roles/${role.id}`);
  };

  const isClosed = role.status === "closed";

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-32">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="eyebrow">Edit Role</div>
            <h1 className="h-page">{role.title}</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {isClosed ? (
              <Button variant="outline" onClick={onReopen}>Reopen role</Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Close role</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close this role?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Auto-pulls stop firing and the role moves to the Closed list. You can reopen it later from this same page.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onCloseRole}>Close role</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </header>

      {/* Phase 5.13.2c smoke: regridded. LEFT column = Details (tall card).
           RIGHT column = Evaluation Prompt + Competitor List stacked.
           Scorecard moves OUT of the grid and renders full-width below as
           its own section. */}
      <div className="grid items-start gap-6 md:grid-cols-2">
        {/* LEFT COLUMN — Details only. */}
        <div className="min-w-0">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Details</span>
            </div>
            <div className="card-pad space-y-6">
              <HQFormField label="Role title" required>
                <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Role title" />
              </HQFormField>

              {/* Location / Type / Compensation row */}
              <div className="grid gap-4 md:grid-cols-3">
                <HQFormField label="Location">
                  <Input value={form.location} onChange={(e) => update("location", e.target.value)} />
                </HQFormField>
                <HQFormField label="Type">
                  <Select value={form.type} onValueChange={(v) => update("type", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Full-Time">Full-Time</SelectItem>
                      <SelectItem value="Contract">Contract</SelectItem>
                      <SelectItem value="Freelance">Freelance</SelectItem>
                    </SelectContent>
                  </Select>
                </HQFormField>
                <HQFormField label="Compensation">
                  <Input value={form.compensation} onChange={(e) => update("compensation", e.target.value)} />
                </HQFormField>
              </div>

              <HQFormField label="Job description" required>
                <Textarea
                  className="min-h-[180px]"
                  value={form.job_description}
                  onChange={(e) => update("job_description", e.target.value)}
                />
              </HQFormField>

              {/* Phase 3.7.6: relabeled from "Hiring priorities not in JD" */}
              <HQFormField label="Additional Priorities and Factors Not in JD">
                <Textarea
                  className="min-h-[100px]"
                  value={form.hiring_priorities}
                  onChange={(e) => update("hiring_priorities", e.target.value)}
                />
              </HQFormField>

              <HQFormField label="Auto-rejection threshold">
                <div className="space-y-2">
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[form.auto_rejection_threshold]}
                    onValueChange={(v) => update("auto_rejection_threshold", v[0] ?? 0)}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span className="font-bold text-primary">{form.auto_rejection_threshold} / 100</span>
                    <span>100</span>
                  </div>
                </div>
              </HQFormField>

              <HQFormField label="Subject line keywords" required>
                <TagInput
                  value={form.email_keywords}
                  onChange={(v) => update("email_keywords", v)}
                  placeholder="Add keyword…"
                  normalize
                />
              </HQFormField>

              <div className="grid gap-4 md:grid-cols-2">
                <HQFormField label="Start pulling from">
                  <Input
                    type="date"
                    value={form.email_search_start_date}
                    onChange={(e) => update("email_search_start_date", e.target.value)}
                  />
                </HQFormField>
                <HQFormField label="Auto-pull schedule">
                  {/* Phase 3.7.6.4: 2×2 grid of options instead of vertical
                       stack. Compacts the height and pairs naturally with
                       Start-pulling-from on the left. */}
                  <RadioGroup
                    value={form.auto_pull_schedule}
                    onValueChange={(v) => update("auto_pull_schedule", v as AutoPullSchedule)}
                    className="grid grid-cols-2 gap-x-4 gap-y-2"
                  >
                    {SCHEDULE_OPTIONS.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <RadioGroupItem value={opt.value} id={`sched-${opt.value}`} />
                        <Label htmlFor={`sched-${opt.value}`} className="text-sm font-normal">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </HQFormField>
              </div>

              {/* Phase 3.7.6.4: hiring manager moved to bottom of section. */}
              <HQFormField label="Hiring manager" required>
                <Select
                  value={form.hiring_manager_id ?? undefined}
                  onValueChange={(v) => update("hiring_manager_id", v || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select admin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.full_name ?? a.email} {a.full_name ? `· ${a.email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </HQFormField>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN — Evaluation Prompt + Competitor List stacked. */}
        <div className="min-w-0 flex flex-col gap-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Evaluation Prompt</span>
            </div>
            <div className="card-pad space-y-4">
              <Textarea
                value={form.evaluation_prompt}
                onChange={(e) => update("evaluation_prompt", e.target.value)}
                className="h-[252px] resize-none overflow-y-auto font-mono text-[12px] leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                Location rules are always applied during evaluation, even when using a custom prompt.
              </p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {form.evaluation_prompt === DEFAULT_EVAL_PROMPT
                    ? "Showing system default"
                    : "Custom prompt for this role"}
                </span>
                <button
                  type="button"
                  onClick={() => update("evaluation_prompt", DEFAULT_EVAL_PROMPT)}
                  className="font-mono uppercase tracking-wider text-primary/80 hover:text-primary"
                  disabled={form.evaluation_prompt === DEFAULT_EVAL_PROMPT}
                >
                  Reset to default
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Competitor List</span>
            </div>
            <div className="card-pad space-y-4">
              <p className="text-xs text-muted-foreground">
                Candidates with experience at any company below earn the competitor bonus.
                3 pts: 1 to 2 yrs · 5 pts: 3 to 4 yrs · 8 pts: 5+ yrs · +2 pts: leadership at competitor.
                Max +{COMPETITOR_BONUS_POINTS} bonus.
              </p>
              {/* Phase 3.7.6.7: when a role has no role-level list saved
                   yet, the form is pre-seeded with the global default and
                   this caption surfaces. Once the user touches the list
                   (any add/remove), usingDefaultCompetitors flips off. */}
              {usingDefaultCompetitors && (
                <p className="text-xs text-primary/80">
                  Showing default competitors list. Edits save to this role only.
                </p>
              )}
              <TagInput
                value={form.competitors}
                onChange={(v) => {
                  setUsingDefaultCompetitors(false);
                  update("competitors", v);
                }}
                placeholder="Add competitor…"
                caseInsensitiveDedup
              />
            </div>
          </section>
        </div>
      </div>

      {/* Scorecard — full-width below the 2-col grid (Phase 5.13.2c smoke). */}
      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Scorecard</span>
          <ScorecardTotalReadout total={scorecardTotal(form.scorecard)} />
        </div>
        <div className="card-pad">
          <ScorecardEditor
            criteria={form.scorecard}
            onChange={(c) => {
              update("scorecard", c);
              setScorecardEditedSinceRefine(true);
            }}
          />
        </div>
      </section>

      {/* Phase 3.7.6.9: save/cancel bar floats sticky-bottom so it's
           always reachable on long pages without scrolling. -mx-6 lets
           the bar background extend the full viewport width even though
           the page wrapper is mx-auto max-w-7xl. backdrop-blur +
           strong bg keeps content underneath legible.

           Phase 3.10: when the scorecard has unrefined edits (any change
           since the last refine pass), the primary action morphs from
           "Save changes" to "Process scorecard" and runs ts-refine-
           scorecard. Once refined, the button flips back to Save and the
           normal confirm-reeval-and-persist flow takes over. */}
      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Button variant="ghost" onClick={() => navigateOrConfirm(`/talent-scout/roles/${role.id}`)}>
            Cancel
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
                {scorecardEditedSinceRefine ? "Scorecard edits pending refine" : "Unsaved changes"}
              </span>
            )}
            {scorecardEditedSinceRefine ? (
              <Button onClick={runRefine} disabled={saving || refining}>
                {refining ? "Refining…" : "Process scorecard →"}
              </Button>
            ) : (
              <Button onClick={requestSave} disabled={saving || refining || !dirty}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Re-eval confirm dialog (JD / prompt / scorecard changes) */}
      <AlertDialog open={confirmReevalOpen} onOpenChange={setConfirmReevalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm re-evaluation</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void persist();
              }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved-changes confirmation when user clicks Cancel / Back. */}
      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits to this role. Leave anyway and discard them, or stay on this page?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                pendingNavRef.current = null;
                setConfirmLeaveOpen(false);
              }}
            >
              Stay
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingNavRef.current;
                pendingNavRef.current = null;
                setConfirmLeaveOpen(false);
                if (target) nav(target);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline scorecard editor — same tier-grouped pattern as NewRoleScorecard
// step 3, but without the wizard / regenerate / final-approve scaffolding.
// Shares CriterionCard + TIER_META with the wizard (extracted Phase 3.7.6).
// ---------------------------------------------------------------------------
function ScorecardEditor({
  criteria,
  onChange,
}: {
  criteria: Criterion[];
  onChange: (next: Criterion[]) => void;
}) {
  const idCounter = useRef(0);
  const total = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);

  const update = (idx: number, patch: Partial<Criterion>) => {
    onChange(criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const remove = (idx: number) => {
    onChange(criteria.filter((_, i) => i !== idx));
  };
  const addManual = (tier: 1 | 2 | 3) => {
    idCounter.current += 1;
    const next: Criterion = {
      name: "",
      tier,
      weight: 0,
      is_disqualifier: false,
      full_points_rubric: "",
      partial_points_rubric: "",
      is_manual: true,
    };
    onChange([...criteria, next]);
  };

  return (
    // Phase 3.7.6.10: removed h-full / flex-col / mt-auto so content sits
    // compactly at the top regardless of how tall the parent Card is.
    // Bumped tier-block spacing space-y-5 → space-y-7 and within-tier
    // space-y-2 → space-y-3 from 3.7.6.9 stays.
    <div className="space-y-7">
      {([1, 2, 3] as const).map((tier) => {
        const items = criteria.map((c, i) => ({ c, i })).filter(({ c }) => c.tier === tier);
        const subtotal = items.reduce((s, { c }) => s + (Number(c.weight) || 0), 0);
        const meta = TIER_META[tier];
        return (
          <div key={tier} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn("pill pill-sm", meta.token)}>
                  {meta.label}
                </span>
                <span className="text-[13px] text-muted-foreground truncate">{meta.subtitle}</span>
              </div>
              <span className="text-[13px] font-bold text-muted-foreground">{subtotal} pts</span>
            </div>
            <div className="space-y-3">
              {items.map(({ c, i }) => (
                <CriterionCard key={i} c={c} onChange={(p) => update(i, p)} onRemove={() => remove(i)} hideManualBorder />
              ))}
              <button
                type="button"
                onClick={() => addManual(tier)}
                className="w-full rounded-md border border-dashed border-border py-3 text-[12px] font-mono font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                + Add tier {tier} criterion
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-[13px] text-muted-foreground">
          Bonus: up to +{COMPETITOR_BONUS_POINTS} pts for competitor experience.
        </span>
        <ScorecardTotalReadout total={total} />
      </div>
    </div>
  );
}



