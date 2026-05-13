// Phase 4.3-port: Brief surface. VS Pro had no real brief page (`/projects/:id/brief`
// was a ComingNext placeholder), so port plan § 9 directs HQ-from-scratch
// design. Closest HQ analog: RoleSettings.tsx -- same dirty-state tracking,
// sticky save bar, cancel-leave AlertDialog, beforeunload guard.
//
// Two action paths: Save (UPDATE only, stay on page) and Continue (UPDATE +
// flip current_step to sheet_prompt + navigate to stepToRoute). The
// sheet-prompt route lands in Phase 4.4-port; until then, Continue 404s
// after save. Spec § 6 makes this explicit; same intentional 404 window
// 4.2-port shipped.
//
// PDF upload + parse affordance lives ABOVE the form fields. Drop a PDF →
// upload to briefs/{scout_id}/{uuid}.pdf → invoke vs-parse-brief → render
// a ParsedPreview → producer clicks Apply (merge into form) or Discard
// (clear preview). The uploaded path appends to brief_data.uploaded_files
// so future Edit Brief / audit screens can re-read the source.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { stepToRoute } from "@/lib/venue-scout/format";
import {
  ScoutSettingsLink,
  ScoutStepThroughNav,
} from "@/components/venue-scout/ScoutChrome";
import {
  appendUploadedFile,
  applyParsedFields,
  EMPTY_BRIEF_FORM,
  fromScout,
  toUpdate,
  type BriefFormState,
  type ParsedBriefFields,
} from "@/lib/venue-scout/briefForm";
import type { Database } from "@/integrations/supabase/types";

type VsScoutRow = Database["public"]["Tables"]["vs_scouts"]["Row"];

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "parsing"; fileName: string }
  | { kind: "parsed"; fileName: string; storage_path: string; parsed: ParsedBriefFields }
  | { kind: "error"; message: string };

const MAX_PDF_SIZE_MB = 10;

export default function Brief() {
  const { id: scoutId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ------- All hooks above any early return (design-system § 12 rule 2) -------
  const [scout, setScout] = useState<VsScoutRow | null>(null);
  const [initial, setInitial] = useState<BriefFormState | null>(null);
  const [form, setForm] = useState<BriefFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // Generation counter for upload+parse: if the producer rapidly drops a
  // second file while the first is still parsing, ignore the older parse's
  // response so the form doesn't get clobbered. Same pattern 4.2-port shipped
  // for openDelete in ScoutIndex.
  const uploadGenRef = useRef(0);

  useEffect(() => {
    if (!scoutId) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("vs_scouts")
        .select(
          "id, client_name, event_name, live_dates, city, budget, event_overview, brief_data, current_step, archived_at, name, status, project_id, sheet_storage_path, derived_columns, generated_decks, deck_order, last_touched_at, created_at, created_by, updated_at, updated_by",
        )
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
      const f = fromScout(data as VsScoutRow);
      setForm(f);
      setInitial(f);
    })();
    return () => {
      active = false;
    };
  }, [scoutId]);

  // beforeunload guard for tab-close / hard-reload when the form is dirty.
  // The button-driven cancel path opens the AlertDialog instead.
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

  // ---------------------- Loading + archived gates ----------------------
  if (!scout || !form || !initial) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const isArchived = scout.archived_at !== null;
  const invalid = !form.client_name.trim() || !form.event_name.trim();
  const update = <K extends keyof BriefFormState>(k: K, v: BriefFormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  // ------------------------- Save / Continue ----------------------------

  const persist = async (advance: boolean): Promise<boolean> => {
    if (invalid) {
      toast({
        title: "Client name and event name are required",
        variant: "destructive",
      });
      return false;
    }
    const payload = toUpdate(form);
    const update_payload: typeof payload & {
      last_touched_at: string;
      updated_by: string | null;
      current_step?: string;
    } = {
      ...payload,
      last_touched_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    };
    if (advance) update_payload.current_step = "sheet_prompt";

    const { error } = await supabase
      .from("vs_scouts")
      .update(update_payload)
      .eq("id", scout.id);
    if (error) {
      toast({
        title: advance ? "Could not continue" : "Save failed",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
    // Refresh the initial baseline so dirty flips off; brief_data on the new
    // initial mirrors what we just sent.
    setInitial(form);
    return true;
  };

  const requestSave = async () => {
    if (saving || continuing) return;
    setSaving(true);
    const ok = await persist(false);
    setSaving(false);
    if (ok) toast({ title: "Brief saved" });
  };

  const requestContinue = async () => {
    if (saving || continuing) return;
    setContinuing(true);
    const ok = await persist(true);
    if (!ok) {
      setContinuing(false);
      return;
    }
    // Navigate immediately; the sheet-prompt route lands in 4.4-port and 404s
    // until then (port plan § 9 + Phase 4.2-port decision still in force).
    navigate(stepToRoute(scout.id, "sheet_prompt"));
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

    // Top-level try/catch: Supabase client methods return { error } rather
    // than throwing, but unexpected runtime errors (crypto.randomUUID failing
    // on an older browser, corrupt file object, etc.) would otherwise leave
    // the upload state stuck on "uploading" or "parsing" with no recovery.
    try {
      setUploadState({ kind: "uploading", fileName: file.name });

      // Storage path: briefs/{scout_id}/{uuid}.pdf. Keyed under the scout so
      // future cleanup crons can scope by scout. UUID prevents collisions
      // when the producer re-uploads with the same filename.
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
    setForm(withFile);
    setUploadState({ kind: "idle" });
    toast({ title: "Brief fields filled in. Review and save." });
  };

  const onDiscardParsed = () => {
    setUploadState({ kind: "idle" });
  };

  const onRetryUpload = () => {
    setUploadState({ kind: "idle" });
  };

  // ------------------------------- Render -------------------------------
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <Link to="/venue-scout" className="crumb">
        ← Back to Venue Scout
      </Link>
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <h1 className="h-page">Brief</h1>
          <p className="text-sm text-muted-foreground">
            {form.event_name && form.client_name
              ? `${form.event_name} · ${form.client_name}`
              : "Project details and sourcing context."}
          </p>
        </div>
        <ScoutSettingsLink scoutId={scout.id} />
      </header>
      <ScoutStepThroughNav scoutId={scout.id} scout={scout} />

      {isArchived && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This scout is archived. Restore it from the Venue Scout index to edit the brief.
        </div>
      )}

      <Card className="bg-surface-alt">
        <CardContent className="space-y-8 p-8">
          {/* Upload affordance is hidden when the scout is archived: producer
              can't save the result anyway, so burning an Anthropic API call
              + storage write makes no sense. Field stack still renders below
              for read-only viewing; inputs gate on isArchived. */}
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

          {/* ---- Project section ---- */}
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

          {/* ---- Logistics section ---- */}
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
            <Field label="City / location">
              <Input
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                placeholder="e.g. New York, NY"
                disabled={isArchived}
              />
            </Field>
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

          {/* ---- Context for sourcing ---- */}
          <section className="space-y-4">
            <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
              Context for sourcing
            </div>
            <Field label="Event overview">
              <Textarea
                value={form.event_overview}
                onChange={(e) => update("event_overview", e.target.value)}
                rows={5}
                placeholder="What the activation is, who it's for, what the vibe should be."
                disabled={isArchived}
              />
            </Field>
            <Field label="Additional notes">
              <Textarea
                value={form.brief_data_notes}
                onChange={(e) => update("brief_data_notes", e.target.value)}
                rows={4}
                placeholder="Anything else the AI should know about: tone, references, must-have features, hard nos."
                disabled={isArchived}
              />
            </Field>
          </section>
        </CardContent>
      </Card>

      {/* ---- Sticky save bar ---- */}
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
              variant="outline"
              onClick={requestSave}
              disabled={saving || continuing || !dirty || invalid || isArchived}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              onClick={requestContinue}
              disabled={saving || continuing || invalid || isArchived}
            >
              {continuing ? "Saving…" : "Continue"}
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Confirm leave dialog ---- */}
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
// returned, with Apply / Discard actions. Kept inline; not used elsewhere.
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
  if (parsed.client_name?.trim()) rows.push({ label: "Client name", value: parsed.client_name.trim() });
  if (parsed.event_name?.trim()) rows.push({ label: "Event name", value: parsed.event_name.trim() });
  if (parsed.live_dates?.trim()) rows.push({ label: "Live dates", value: parsed.live_dates.trim() });
  if (parsed.city?.trim()) rows.push({ label: "City", value: parsed.city.trim() });
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
  if (parsed.event_overview?.trim()) {
    rows.push({ label: "Event overview", value: parsed.event_overview.trim() });
  }
  if (parsed.additional_notes?.trim()) {
    rows.push({ label: "Additional notes", value: parsed.additional_notes.trim() });
  }

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

// ---------------------------------------------------------------------------
// Inline Field -- label + content wrapper, matches NewScout.tsx (4.2-port).
// text-primary because design-system doc drift between text-foreground (TS)
// and text-primary (4.2-port VS) is unresolved; using text-primary keeps
// continuity with NewScout. Reconciliation owed at the design-system §3
// pass per the carry-forward note in 4.2-port SHIPPED.
// ---------------------------------------------------------------------------
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
      <Label className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </Label>
      {children}
    </div>
  );
}
