import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      // deno-lint-ignore no-explicit-any
      scorecard: form.scorecard as any,
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
          title: "Saved — re-eval kickoff failed",
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
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Title row — back link, title, close-role button on the right. */}
      <header className="space-y-3">
        <button
          type="button"
          onClick={() => navigateOrConfirm(`/talent-scout/roles/${role.id}`)}
          className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline"
        >
          ← Back to role
        </button>
        {/* Phase 3.7.6.7: page header simplified — role title moved into
             the Role Details card title row (coral, larger). The page-
             level h1 'Edit role' subtitle line is gone. */}
        <div className="flex items-start justify-between gap-6">
          <h1 className="h-page">Edit role</h1>
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

      {/* Phase 3.7.6.11: switched from a 2-column flex-of-stacks to an
           explicit 2-column × 3-row grid so the Scorecard card on the
           right can be precisely bounded to the LEFT column's three
           cards (Role Details, Eval Prompt, Competitor List). Top of
           Scorecard aligns with top of Role Details; bottom of Scorecard
           aligns with bottom of Competitor List. If the scorecard's
           content exceeds that height, the inner body scrolls. */}
      <div className="grid items-start gap-6 md:grid-cols-2 md:grid-rows-[auto_auto_auto]">
        {/* LEFT COLUMN — three separate grid items, one per row, col 1. */}
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <Card className="bg-surface-alt">
            <CardContent className="space-y-6 p-6">
              {/* Phase 3.7.6.7: title row carries both the section label
                   and the editable role title (coral, larger size). The
                   "Role title" Field below is removed; the title is the
                   single editable field in this row. */}
              <div className="flex items-center justify-between gap-4 border-b border-border -mx-6 -mt-6 px-6 pt-6 pb-3 mb-4">
                <div className="label-section text-[15px]">Role Details</div>
                <input
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  placeholder="Role title"
                  className="flex-1 max-w-[60%] bg-transparent text-right font-display text-[20px] font-extrabold uppercase tracking-wide text-primary outline-none focus:underline"
                />
              </div>

              {/* Location / Type / Compensation row sits directly under the title */}
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Location">
                  <Input value={form.location} onChange={(e) => update("location", e.target.value)} />
                </Field>
                <Field label="Type">
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
                </Field>
                <Field label="Compensation">
                  <Input value={form.compensation} onChange={(e) => update("compensation", e.target.value)} />
                </Field>
              </div>

              <Field label="Job description" required>
                <Textarea
                  className="min-h-[180px]"
                  value={form.job_description}
                  onChange={(e) => update("job_description", e.target.value)}
                />
              </Field>

              {/* Phase 3.7.6: relabeled from "Hiring priorities not in JD" */}
              <Field label="Additional Priorities and Factors Not in JD">
                <Textarea
                  className="min-h-[100px]"
                  value={form.hiring_priorities}
                  onChange={(e) => update("hiring_priorities", e.target.value)}
                />
              </Field>

              <Field label="Auto-rejection threshold">
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
              </Field>

              <Field label="Subject line keywords" required>
                <TagInput
                  value={form.email_keywords}
                  onChange={(v) => update("email_keywords", v)}
                  placeholder="Add keyword…"
                  normalize
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Start pulling from">
                  <Input
                    type="date"
                    value={form.email_search_start_date}
                    onChange={(e) => update("email_search_start_date", e.target.value)}
                  />
                </Field>
                <Field label="Auto-pull schedule">
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
                </Field>
              </div>

              {/* Phase 3.7.6.4: hiring manager moved to bottom of section. */}
              <Field label="Hiring manager" required>
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
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* LEFT COLUMN row 2 — Evaluation Prompt. Phase 3.7.6.11: own grid
             item so the Scorecard on the right can bound itself to row 1+2+3. */}
        <div className="min-w-0 md:col-start-1 md:row-start-2">
          <Card className="bg-surface-alt">
            <CardContent className="space-y-4 p-6">
              <div className="label-section pb-2 border-b border-border -mx-6 -mt-6 px-6 pt-6 mb-4">
                Evaluation Prompt
              </div>
              <Textarea
                value={form.evaluation_prompt}
                onChange={(e) => update("evaluation_prompt", e.target.value)}
                className="h-[252px] resize-none overflow-y-auto font-mono text-[12px] leading-relaxed"
              />
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
            </CardContent>
          </Card>
        </div>

        {/* LEFT COLUMN row 3 — Role Competitor List. Last item in col 1;
             Scorecard's bottom edge aligns with this card's bottom. */}
        <div className="min-w-0 md:col-start-1 md:row-start-3">
          <Card className="bg-surface-alt">
            <CardContent className="space-y-4 p-6">
              <div className="label-section pb-2 border-b border-border -mx-6 -mt-6 px-6 pt-6 mb-4">
                Role Competitor List
              </div>
              <p className="text-xs text-muted-foreground">
                Candidates with experience at any company below earn the competitor bonus.
                3 pts: 1–2 yrs · 5 pts: 3–4 yrs · 8 pts: 5+ yrs · +2 pts: leadership at competitor.
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
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — Scorecard. Phase 3.7.6.11: spans col 2 across
             all 3 left-column rows. min-h-0 keeps it from forcing the
             grid rows to expand if its content would otherwise be
             taller than the left stack. overflow-hidden + h-full +
             flex-col on Card and an inner overflow-y-auto body means
             content scrolls inside the card when it exceeds the
             bounded height — top edge aligns with Role Details, bottom
             with Competitor List. */}
        <div className="min-w-0 min-h-0 overflow-hidden md:col-start-2 md:row-span-3 md:row-start-1">
          <Card className="flex h-full flex-col bg-surface-alt">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
              <div className="label-section text-[15px]">Scorecard</div>
              <ScorecardTotalReadout total={scorecardTotal(form.scorecard)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <ScorecardEditor
                criteria={form.scorecard}
                onChange={(c) => update("scorecard", c)}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Phase 3.7.6.9: save/cancel bar floats sticky-bottom so it's
           always reachable on long pages without scrolling. -mx-6 lets
           the bar background extend the full viewport width even though
           the page wrapper is mx-auto max-w-7xl. backdrop-blur +
           strong bg keeps content underneath legible. */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigateOrConfirm(`/talent-scout/roles/${role.id}`)}>
            ← Cancel
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
                Unsaved changes
              </span>
            )}
            <Button onClick={requestSave} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
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
                <span className={cn("inline-flex items-center rounded-sm border px-2.5 py-1 text-[12px] font-mono font-bold uppercase tracking-wider", meta.color)}>
                  {meta.label}
                </span>
                <span className="text-[13px] text-muted-foreground truncate">{meta.subtitle}</span>
              </div>
              <span className="text-[13px] font-bold text-muted-foreground">{subtotal} pts</span>
            </div>
            <div className="space-y-3">
              {items.map(({ c, i }) => (
                <CriterionCard key={i} c={c} onChange={(p) => update(i, p)} onRemove={() => remove(i)} />
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
      <Label className="text-[12px] font-mono font-bold uppercase tracking-wider text-foreground">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
