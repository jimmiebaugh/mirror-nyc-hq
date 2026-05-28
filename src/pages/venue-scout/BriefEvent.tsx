// Phase 4 Revision - Intake Step 1: Brief Upload + Event Details.
//
// First step of the 3-step brief stepper (Event -> Venue -> Review). Replaces
// the top half of the old single-page Brief.tsx. The PDF upload + parse
// affordance is lifted verbatim from Brief.tsx (DropZone, the four upload
// states, ParsedPreview, Apply / Discard, MAX_PDF_SIZE_MB).
//
// The form is one logical entity across all three steps; working state lives
// in briefIntakeStore so Step 2's Back preserves in-memory edits. Continue
// persists everything via toUpdate and navigates to /brief/venue. current_step
// is NOT touched here -- only Step 3's Confirm & Continue advances it.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { DropZone } from "@/components/ui/DropZone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { ScoutPageHeader } from "@/components/venue-scout/ScoutPageHeader";
import { HQFormField } from "@/components/hq/HQFormField";
import { Stepper } from "@/components/venue-scout/Stepper";
import { TagInput } from "@/components/venue-scout/TagInput";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  appendUploadedFile,
  applyParsedFields,
  fromScout,
  toUpdate,
  type BriefFormState,
  type ParsedBriefFields,
} from "@/lib/venue-scout/briefForm";
import { briefIntake } from "@/lib/venue-scout/briefIntakeStore";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type VsScoutRow = Database["public"]["Tables"]["vs_scouts"]["Row"];

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "parsing"; fileName: string }
  | { kind: "parsed"; fileName: string; storage_path: string; parsed: ParsedBriefFields }
  | { kind: "error"; message: string };

const MAX_PDF_SIZE_MB = 10;

const SCOUT_SELECT =
  "id, client_name, event_name, live_dates, city, budget, event_overview, brief_data, current_step, archived_at, name, status, project_id, sheet_storage_path, derived_columns, generated_decks, deck_order, last_touched_at, created_at, created_by, updated_at, updated_by";

export default function BriefEvent() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ------- All hooks above any early return (design-system § 12 rule 2) -------
  const [scout, setScout] = useState<VsScoutRow | null>(null);
  const [initial, setInitial] = useState<BriefFormState | null>(null);
  const [form, setForm] = useState<BriefFormState | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // Generation counter for upload+parse: if the producer rapidly drops a
  // second file while the first is still parsing, ignore the older parse.
  const uploadGenRef = useRef(0);

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
      // Working form: use the cross-step cache if present, else hydrate from
      // the row and seed the cache.
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
  const invalid = !form.client_name.trim() || !form.event_name.trim();

  const update = <K extends keyof BriefFormState>(k: K, v: BriefFormState[K]) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, [k]: v };
      briefIntake.setForm(scoutId, next);
      return next;
    });
  };

  const applyForm = (next: BriefFormState) => {
    briefIntake.setForm(scoutId, next);
    setForm(next);
  };

  // ------------------------- Continue / Cancel ----------------------------

  const requestContinue = async () => {
    if (continuing) return;
    if (invalid) {
      toast({
        title: "Client name and event name are required",
        variant: "destructive",
      });
      return;
    }
    setContinuing(true);
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
      setContinuing(false);
      toast({
        title: "Could not continue",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    briefIntake.commit(scoutId, form);
    setInitial(form);
    navigate(`/venue-scout/scouts/${scout.id}/brief/venue`);
  };

  const requestCancel = () => {
    if (dirty) {
      setConfirmLeaveOpen(true);
      return;
    }
    navigate("/venue-scout");
  };

  // -------------------------- PDF upload + parse --------------------------

  const handleDropFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const gen = ++uploadGenRef.current;
    try {
      setUploadState({ kind: "uploading", fileName: file.name });
      const storage_path = `${scout.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("briefs")
        .upload(storage_path, file, { contentType: "application/pdf" });
      if (gen !== uploadGenRef.current) return;
      if (uploadErr) {
        setUploadState({ kind: "error", message: `Upload failed: ${uploadErr.message}` });
        return;
      }

      setUploadState({ kind: "parsing", fileName: file.name });
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "vs-parse-brief",
        { body: { scout_id: scout.id, storage_path } },
      );
      if (gen !== uploadGenRef.current) return;

      if (invokeErr) {
        setUploadState({
          kind: "error",
          message: invokeErr.message || "vs-parse-brief failed",
        });
        return;
      }

      const responseError = (data as { error?: string } | null)?.error;
      if (responseError) {
        setUploadState({ kind: "error", message: responseError });
        return;
      }

      const parsed = (data as { parsed_fields?: ParsedBriefFields } | null)
        ?.parsed_fields ?? {};
      setUploadState({ kind: "parsed", fileName: file.name, storage_path, parsed });
    } catch (e) {
      if (gen !== uploadGenRef.current) return;
      setUploadState({
        kind: "error",
        message: e instanceof Error ? e.message : "Unexpected error",
      });
    }
  };

  const onApplyParsed = (filteredParsed: ParsedBriefFields) => {
    if (uploadState.kind !== "parsed") return;
    const merged = applyParsedFields(form, filteredParsed);
    const withFile = appendUploadedFile(merged, uploadState.storage_path);
    applyForm(withFile);
    setUploadState({ kind: "idle" });
    toast({ title: "Brief fields filled in. Review and continue." });
  };

  const onDiscardParsed = () => setUploadState({ kind: "idle" });
  const onRetryUpload = () => setUploadState({ kind: "idle" });

  // Activations slider: position 0 stores null ("TBD"); 1-10 store the value
  // (10 displays as "10+").
  const activationsPos = form.activations_count ?? 0;
  const activationsLabel =
    form.activations_count === null
      ? "TBD"
      : form.activations_count >= 10
        ? "10+"
        : String(form.activations_count);

  // ------------------------------- Render -------------------------------
  // Phase 5.12.14.3 Round 4 § 7.A: outer drops `mx-auto max-w-3xl` and goes
  // full-width inside the AppShell chrome. `stack-6` (24px gap) replaces the
  // legacy `space-y-6` so vertical rhythm matches BriefReport.
  return (
    <div className="stack-6 pb-32">
      <header className="space-y-2">
        {/* R7 amendment v3 § 2: BriefEvent migrated to ScoutPageHeader
            matching BriefVenue (R7 amendment v2 § 5 producer-call). The
            intake Stepper (Event vs Venue intake sub-step indicator)
            stays inline with the Brief title below; it's a separate
            concern from the multi-page ScoutPhaseBreadcrumb. */}
        <ScoutPageHeader scoutId={scout.id} scout={scout} />
        {/* Item 5 revision round 2: intake Stepper inline with Brief title.
            No coral border / connector. The "→" arrow on the title cues
            forward motion into the sub-step. Stepper renders informational
            (smaller, no hover) — see Stepper.tsx for treatment. */}
        <div className="flex items-center gap-5">
          <h1 className="h-page">Brief →</h1>
          <Stepper active={1} />
        </div>
      </header>

      {isArchived && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          This scout is archived. Restore it from the Venue Scout index to edit the brief.
        </div>
      )}

      {/* Phase 5.12.14.3 Round 4 amendment: VS card-canon. Outer "Event" card
          hosts two nested cards (Upload Brief + Details). Sub-section eyebrows
          + section wrappers retired; .card-headbar + .h-card chrome replaces
          them. Vibe + Aesthetic migrated to BriefVenue Row 4 (state shape
          unchanged -- brief_data is flat jsonb, so only the JSX moves). */}
      <section className="card">
        <div className="card-headbar">
          <h2 className="h-card">Event</h2>
        </div>
        <div className="card-pad space-y-6">

          {/* Upload Brief (nested card; hidden when archived because the
              parser write + Anthropic call would be wasted). */}
          {!isArchived && (
            <section className="card">
              <div className="card-headbar">
                <div className="flex items-baseline gap-2">
                  <h3 className="h-card">Upload Brief</h3>
                  <span className="text-xs text-muted-foreground">
                    · Drop a PDF and we'll pre-fill the form
                  </span>
                </div>
              </div>
              <div className="card-pad space-y-3">
                {uploadState.kind === "idle" && (
                  <DropZone
                    accept="application/pdf"
                    maxSizeMb={MAX_PDF_SIZE_MB}
                    hint={`PDF up to ${MAX_PDF_SIZE_MB} MB`}
                    files={[]}
                    onAdd={(files) => void handleDropFiles(files)}
                    onRemove={() => {
                      /* idle state has no files; noop */
                    }}
                  />
                )}

                {(uploadState.kind === "uploading" || uploadState.kind === "parsing") && (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-input px-4 py-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-foreground">
                      {uploadState.kind === "uploading" ? "Uploading" : "Reading the brief"}…
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {uploadState.fileName}
                    </span>
                  </div>
                )}

                {uploadState.kind === "parsed" && (
                  <ParsedPreview
                    fileName={uploadState.fileName}
                    parsed={uploadState.parsed}
                    onApply={onApplyParsed}
                    onDiscard={onDiscardParsed}
                  />
                )}

                {uploadState.kind === "error" && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <span className="min-w-0 truncate">{uploadState.message}</span>
                    <button
                      type="button"
                      onClick={onRetryUpload}
                      className="shrink-0 font-mono uppercase tracking-wider text-primary hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Details (nested card; 3 grid rows). */}
          <section className="card">
            <div className="card-headbar">
              <h3 className="h-card">Details</h3>
            </div>
            <div className="card-pad space-y-6">
              {/* Row 1: Client Name | Event Name */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <HQFormField label="Client Name" required>
                  <Input
                    value={form.client_name}
                    onChange={(e) => update("client_name", e.target.value)}
                    placeholder="e.g. Hennessy"
                    disabled={isArchived}
                  />
                </HQFormField>
                <HQFormField label="Event Name" required>
                  <Input
                    value={form.event_name}
                    onChange={(e) => update("event_name", e.target.value)}
                    placeholder="e.g. Hennessy V.S Launch"
                    disabled={isArchived}
                  />
                </HQFormField>
              </div>

              {/* Row 2: Live Date(s) | Budget | # of Spaces */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <HQFormField label="Live Date(s)">
                  <DateRangePicker
                    value={form.live_dates}
                    onChange={(v) => update("live_dates", v)}
                    placeholder="Select live dates"
                    disabled={isArchived}
                  />
                </HQFormField>
                <HQFormField label="Budget">
                  <Input
                    value={form.budget_text}
                    onChange={(e) => {
                      // R6 § D.2: auto-format as `$X,XXX` (no decimals)
                      // on every keystroke. Strip non-digits, reformat with
                      // en-US thousands separator. Empty input passes through
                      // as empty so the field can clear. Cursor may jump to
                      // end mid-edit; tolerated for now (flag for v2 if
                      // smoke catches it).
                      const digits = e.target.value.replace(/[^0-9]/g, "");
                      if (!digits) {
                        update("budget_text", "");
                        return;
                      }
                      const n = parseInt(digits, 10);
                      update(
                        "budget_text",
                        Number.isFinite(n)
                          ? `$${n.toLocaleString("en-US")}`
                          : "",
                      );
                    }}
                    placeholder="$0"
                    disabled={isArchived}
                  />
                </HQFormField>
                <HQFormField
                  label={
                    <span className="flex items-baseline justify-between">
                      <span># of Spaces</span>
                      <span className="font-mono text-xs normal-case tracking-normal text-muted-foreground">
                        · {activationsLabel}
                      </span>
                    </span>
                  }
                >
                  {/* R4 amendment v3 § 3: flex h-10 items-center aligns the
                      slider thumb with the vertical centers of the other Row 2
                      controls (DateRangePicker + Budget Input ~40px). `pt-2`
                      retired; `w-full` on the Slider preserves full-width. */}
                  <div className="flex h-10 items-center">
                    <Slider
                      value={[activationsPos]}
                      min={0}
                      max={10}
                      step={1}
                      onValueChange={([v]) =>
                        update("activations_count", v === 0 ? null : v)
                      }
                      disabled={isArchived}
                      className="w-full"
                    />
                  </div>
                </HQFormField>
              </div>

              {/* Row 3: Event Objectives | Target Audience */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <HQFormField label="Event Objectives">
                  <TagInput
                    value={form.objectives}
                    onChange={(v) => update("objectives", v)}
                    placeholder="e.g. Brand awareness, then Enter"
                    disabled={isArchived}
                  />
                </HQFormField>
                <HQFormField label="Target Audience">
                  <TagInput
                    value={form.target_audience}
                    onChange={(v) => update("target_audience", v)}
                    placeholder="e.g. Runners, Basketball Fans, then Enter"
                    disabled={isArchived}
                  />
                </HQFormField>
              </div>
            </div>
          </section>

        </div>
      </section>

      {/* ---- Sticky footer ---- */}
      <div className="actionbar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Button variant="ghost" onClick={requestCancel}>
            ← Cancel
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-warn">
                Unsaved changes
              </span>
            )}
            <Button
              onClick={requestContinue}
              disabled={continuing || invalid || isArchived}
            >
              {continuing ? "Saving…" : "Continue"}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits to the brief. Leave anyway and discard them, or stay on this page?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmLeaveOpen(false)}>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmLeaveOpen(false);
                briefIntake.reset();
                navigate("/venue-scout");
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
// Inline ParsedPreview -- read-only display of the fields vs-parse-brief
// returned, with Apply / Discard actions. Lifted from the old Brief.tsx and
// extended to surface the Phase 4 Revision parsed fields. Phase 5.12.13.6:
// each row is opt-out via a per-row checkbox; the parent receives only the
// keys the producer left checked. Phase 5.12.13.7: live_dates can arrive as
// a multi-option array (multi-city briefs, multi-date offers); that row
// renders as an inline radio group with the first option pre-selected and
// writes the chosen string into the form via the singular key. (Install /
// strike dates retired in 5.12.14.3; only live_dates carries multi-option.)
// ---------------------------------------------------------------------------
type SingleRow = {
  kind: "single";
  key: keyof ParsedBriefFields;
  label: string;
  value: string;
};
type OptionsRow = {
  kind: "options";
  key: "live_dates";
  label: string;
  options: string[];
};
type ParsedRow = SingleRow | OptionsRow;

function ParsedPreview({
  fileName,
  parsed,
  onApply,
  onDiscard,
}: {
  fileName: string;
  parsed: ParsedBriefFields;
  onApply: (filteredParsed: ParsedBriefFields) => void;
  onDiscard: () => void;
}) {
  const rows: ParsedRow[] = [];
  const pushStr = (
    key: keyof ParsedBriefFields,
    label: string,
    v: string | null | undefined,
  ) => {
    if (v && v.trim()) rows.push({ kind: "single", key, label, value: v.trim() });
  };
  const pushArr = (
    key: keyof ParsedBriefFields,
    label: string,
    v: string[] | null | undefined,
  ) => {
    if (Array.isArray(v) && v.length > 0) {
      rows.push({ kind: "single", key, label, value: v.join(", ") });
    }
  };
  // Date row builder: multi-option array (≥2 distinct items) renders as a
  // radio group; otherwise falls back to the singular string. The server-side
  // sanitizer already collapses a one-item options array into the singular
  // field, but defending against a future schema shift or a hand-built
  // request is cheap.
  const pushDate = (
    key: "live_dates",
    label: string,
    single: string | null | undefined,
    options: string[] | null | undefined,
  ) => {
    const cleaned: string[] = [];
    if (Array.isArray(options)) {
      for (const o of options) {
        if (typeof o !== "string") continue;
        const t = o.trim();
        if (t && !cleaned.includes(t)) cleaned.push(t);
      }
    }
    if (cleaned.length >= 2) {
      rows.push({ kind: "options", key, label, options: cleaned });
      return;
    }
    const fallback = single?.trim() || cleaned[0] || "";
    if (fallback) rows.push({ kind: "single", key, label, value: fallback });
  };

  pushStr("client_name", "Client name", parsed.client_name);
  pushStr("event_name", "Event name", parsed.event_name);
  pushDate("live_dates", "Live dates", parsed.live_dates, parsed.live_dates_options);
  pushStr("city", "City", parsed.city);
  if (typeof parsed.budget === "number" && Number.isFinite(parsed.budget)) {
    rows.push({
      kind: "single",
      key: "budget",
      label: "Budget",
      value: `$${parsed.budget.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    });
  }
  if (
    typeof parsed.expected_guest_count === "number" &&
    Number.isFinite(parsed.expected_guest_count)
  ) {
    rows.push({
      kind: "single",
      key: "expected_guest_count",
      label: "Expected guest count",
      value: String(Math.round(parsed.expected_guest_count)),
    });
  }
  if (
    typeof parsed.activations_count === "number" &&
    Number.isFinite(parsed.activations_count)
  ) {
    rows.push({
      kind: "single",
      key: "activations_count",
      label: "Activations / spaces",
      value: String(Math.round(parsed.activations_count)),
    });
  }
  pushArr("objectives", "Objectives", parsed.objectives);
  pushArr("target_audience", "Target audience", parsed.target_audience);
  // R6 § M.12: vibe_aesthetic state lives on the BriefVenue page now, but
  // the parser still extracts it from the brief PDF on the BriefEvent
  // upload step. Surface a small inline indicator so producers know where
  // the field will render after Apply (the value still lands on the same
  // form key; only the visual home of the field is on a different page).
  pushArr(
    "vibe_aesthetic",
    "Vibe / aesthetic (→ shows on Venue page)",
    parsed.vibe_aesthetic,
  );
  pushArr("target_neighborhoods", "Target neighborhoods", parsed.target_neighborhoods);
  pushArr("venue_types", "Venue types", parsed.venue_types);
  pushArr("ideal_features", "Ideal features", parsed.ideal_features);
  // event_overview is intentionally NOT surfaced in the preview card: it's
  // generated downstream by vs-generate-brief-overview (Submit Brief step)
  // and editable inline there. Producers see a single source of truth for
  // the overview at the point they're reviewing it, not duplicated here.

  // Default-checked: every parsed row starts selected. The parsed prop is
  // stable across re-renders (ParsedPreview unmounts on any uploadState
  // transition away from "parsed"), so the lazy initializer captures the full
  // row set once and toggles drive state thereafter.
  const [selected, setSelected] = useState<Set<keyof ParsedBriefFields>>(
    () => new Set(rows.map((r) => r.key)),
  );

  // Phase 5.12.13.7: for "options" rows the chosen string lives here. First
  // option pre-selected; producer can flip between alternatives, and the
  // selected value flows back through filtered[singleKey] on Apply.
  const [optionPick, setOptionPick] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) {
      if (r.kind === "options") init[r.key] = r.options[0];
    }
    return init;
  });

  const toggle = (key: keyof ParsedBriefFields) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(rows.map((r) => r.key)));
  const selectNone = () => setSelected(new Set());

  const handleApply = () => {
    const filtered: ParsedBriefFields = {};
    for (const r of rows) {
      if (!selected.has(r.key)) continue;
      if (r.kind === "options") {
        const chosen = optionPick[r.key];
        if (chosen) (filtered as Record<string, unknown>)[r.key] = chosen;
      } else {
        (filtered as Record<string, unknown>)[r.key] = parsed[r.key];
      }
    }
    onApply(filtered);
  };

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
            Parsed brief
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{fileName}</p>
        </div>
        {rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
            <button
              type="button"
              onClick={selectAll}
              className="text-primary hover:underline"
            >
              Select all
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-primary hover:underline"
            >
              Select none
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          We couldn't pull any fields from this PDF. Discard and fill in the form manually, or try a different file.
        </p>
      ) : (
        <dl className="space-y-2">
          {rows.map((r) => {
            const isChecked = selected.has(r.key);
            return (
              <div
                key={r.key}
                className="grid grid-cols-[24px_160px_1fr] items-start gap-3 text-sm"
              >
                <div className="pt-0.5">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(r.key)}
                    aria-label={`Apply ${r.label}`}
                  />
                </div>
                <dt
                  className={cn(
                    "font-mono text-xs uppercase tracking-wider",
                    isChecked ? "text-muted-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {r.label}
                </dt>
                <dd>
                  {r.kind === "single" ? (
                    <span
                      className={cn(
                        "whitespace-pre-wrap",
                        isChecked
                          ? "text-foreground"
                          : "text-muted-foreground/60 line-through",
                      )}
                    >
                      {r.value}
                    </span>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label={r.label}
                      className="flex flex-col gap-1"
                    >
                      {r.options.map((opt) => (
                        <label
                          key={opt}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-2",
                            !isChecked && "cursor-not-allowed",
                          )}
                        >
                          <input
                            type="radio"
                            name={`parsed-${r.key}`}
                            value={opt}
                            checked={optionPick[r.key] === opt}
                            disabled={!isChecked}
                            onChange={() =>
                              setOptionPick((prev) => ({ ...prev, [r.key]: opt }))
                            }
                            className="h-3.5 w-3.5 shrink-0 accent-primary"
                          />
                          <span
                            className={cn(
                              "whitespace-pre-wrap",
                              isChecked
                                ? "text-foreground"
                                : "text-muted-foreground/60 line-through",
                            )}
                          >
                            {opt}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={handleApply} disabled={selected.size === 0}>
          Apply ({selected.size} selected)
        </Button>
      </div>
    </div>
  );
}

