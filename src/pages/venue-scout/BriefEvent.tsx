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
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";
import { Stepper } from "@/components/venue-scout/Stepper";
import { TagInput } from "@/components/venue-scout/TagInput";
import {
  appendUploadedFile,
  applyParsedFields,
  fromScout,
  toUpdate,
  type BriefFormState,
  type ParsedBriefFields,
} from "@/lib/venue-scout/briefForm";
import { briefIntake } from "@/lib/venue-scout/briefIntakeStore";
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

  const onApplyParsed = () => {
    if (uploadState.kind !== "parsed") return;
    const merged = applyParsedFields(form, uploadState.parsed);
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
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <Link to="/venue-scout" className="crumb">
        ← Back to Venue Scout
      </Link>
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <h1 className="h-page">Event Details</h1>
          <p className="text-sm text-muted-foreground">
            Drop a brief PDF and we'll pre-fill what we find. Edit anything
            before continuing.
          </p>
        </div>
        <ScoutSettingsLink scoutId={scout.id} />
      </header>
      <ScoutStepThroughNav scoutId={scout.id} scout={scout} />
      <Stepper active={1} />

      {isArchived && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This scout is archived. Restore it from the Venue Scout index to edit the brief.
        </div>
      )}

      <Card className="bg-surface-alt">
        <CardContent className="space-y-8 p-8">
          {/* Upload affordance: hidden when archived (producer can't save the
              result anyway, so burning an Anthropic call + storage write makes
              no sense). */}
          {!isArchived && (
            <section className="space-y-3">
              <div className="space-y-1">
                <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
                  Upload brief
                </div>
                <p className="text-xs text-muted-foreground">
                  Drop a PDF and we'll pre-fill the form. You can edit anything before saving.
                </p>
              </div>

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
            </section>
          )}

          {/* ---- Project ---- */}
          <section className="space-y-4">
            <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
              Project
            </div>
            <Field label="Client name" required>
              <Input
                value={form.client_name}
                onChange={(e) => update("client_name", e.target.value)}
                placeholder="e.g. Hennessy"
                disabled={isArchived}
              />
            </Field>
            <Field label="Event name" required>
              <Input
                value={form.event_name}
                onChange={(e) => update("event_name", e.target.value)}
                placeholder="e.g. Hennessy V.S Launch"
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Logistics ---- */}
          <section className="space-y-4">
            <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
              Logistics
            </div>
            <Field label="Live dates">
              <Input
                value={form.live_dates}
                onChange={(e) => update("live_dates", e.target.value)}
                placeholder="e.g. October 15-17, 2026"
                disabled={isArchived}
              />
            </Field>
            <Field label="Install dates">
              <Input
                value={form.install_dates}
                onChange={(e) => update("install_dates", e.target.value)}
                placeholder="e.g. October 13-14, 2026"
                disabled={isArchived}
              />
            </Field>
            <Field label="Strike dates">
              <Input
                value={form.strike_dates}
                onChange={(e) => update("strike_dates", e.target.value)}
                placeholder="e.g. October 18, 2026"
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Budget + Activations ---- */}
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field label="Budget">
              <Input
                value={form.budget_text}
                onChange={(e) => update("budget_text", e.target.value)}
                placeholder="e.g. $50,000"
                disabled={isArchived}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Stored as a number. Format with $ / commas as you like.
              </p>
            </Field>
            <Field label="Number of activations / spaces">
              <div className="flex items-center gap-4 pt-2">
                <Slider
                  value={[activationsPos]}
                  min={0}
                  max={10}
                  step={1}
                  onValueChange={([v]) =>
                    update("activations_count", v === 0 ? null : v)
                  }
                  disabled={isArchived}
                  className="flex-1"
                />
                <span className="w-12 shrink-0 text-right font-mono text-sm font-bold text-foreground">
                  {activationsLabel}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Slide to the bottom for TBD.
              </p>
            </Field>
          </section>

          {/* ---- Objectives ---- */}
          <section className="space-y-4">
            <Field label="Objectives">
              <TagInput
                value={form.objectives}
                onChange={(v) => update("objectives", v)}
                placeholder="e.g. Brand awareness, then Enter"
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Target Audience ---- */}
          <section className="space-y-4">
            <Field label="Target audience">
              <Textarea
                value={form.target_audience}
                onChange={(e) => update("target_audience", e.target.value)}
                rows={4}
                placeholder="Who the activation is for: demographics, mindset, the people you want in the room."
                disabled={isArchived}
              />
            </Field>
          </section>

          {/* ---- Vibe / Aesthetic ---- */}
          <section className="space-y-4">
            <Field label="Target venue vibe / aesthetic">
              <Textarea
                value={form.vibe_aesthetic}
                onChange={(e) => update("vibe_aesthetic", e.target.value)}
                rows={4}
                placeholder="The look and feel the venue should carry: raw and industrial, polished, intimate, etc."
                disabled={isArchived}
              />
            </Field>
          </section>
        </CardContent>
      </Card>

      {/* ---- Sticky footer ---- */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t-2 border-primary/40 bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Button variant="ghost" onClick={requestCancel}>
            ← Cancel
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400">
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
// extended to surface the Phase 4 Revision parsed fields.
// ---------------------------------------------------------------------------
function ParsedPreview({
  fileName,
  parsed,
  onApply,
  onDiscard,
}: {
  fileName: string;
  parsed: ParsedBriefFields;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const rows: { label: string; value: string }[] = [];
  const pushStr = (label: string, v: string | null | undefined) => {
    if (v && v.trim()) rows.push({ label, value: v.trim() });
  };
  const pushArr = (label: string, v: string[] | null | undefined) => {
    if (Array.isArray(v) && v.length > 0) rows.push({ label, value: v.join(", ") });
  };

  pushStr("Client name", parsed.client_name);
  pushStr("Event name", parsed.event_name);
  pushStr("Live dates", parsed.live_dates);
  pushStr("Install dates", parsed.install_dates);
  pushStr("Strike dates", parsed.strike_dates);
  pushStr("City", parsed.city);
  if (typeof parsed.budget === "number" && Number.isFinite(parsed.budget)) {
    rows.push({
      label: "Budget",
      value: `$${parsed.budget.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    });
  }
  if (
    typeof parsed.expected_guest_count === "number" &&
    Number.isFinite(parsed.expected_guest_count)
  ) {
    rows.push({
      label: "Expected guest count",
      value: String(Math.round(parsed.expected_guest_count)),
    });
  }
  if (
    typeof parsed.activations_count === "number" &&
    Number.isFinite(parsed.activations_count)
  ) {
    rows.push({
      label: "Activations / spaces",
      value: String(Math.round(parsed.activations_count)),
    });
  }
  pushArr("Objectives", parsed.objectives);
  pushStr("Target audience", parsed.target_audience);
  pushStr("Vibe / aesthetic", parsed.vibe_aesthetic);
  pushArr("Target neighborhoods", parsed.target_neighborhoods);
  pushArr("Venue types", parsed.venue_types);
  pushArr("Ideal features", parsed.ideal_features);
  pushStr("Event overview", parsed.event_overview);

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
            Parsed brief
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{fileName}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          We couldn't pull any fields from this PDF. Discard and fill in the form manually, or try a different file.
        </p>
      ) : (
        <dl className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[160px_1fr] gap-3 text-sm">
              <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {r.label}
              </dt>
              <dd className="whitespace-pre-wrap text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={onApply} disabled={rows.length === 0}>
          Apply
        </Button>
      </div>
    </div>
  );
}

// Inline Field -- label + content wrapper. 13px font-mono text-primary label,
// matches the old Brief.tsx / NewScout.tsx page-form Field shape.
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
