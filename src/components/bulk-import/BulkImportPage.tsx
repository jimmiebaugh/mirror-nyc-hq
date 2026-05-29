import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Loader2 } from "lucide-react";
import { Stepper } from "@/components/ui/Stepper";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { invalidateLookup } from "@/lib/hq/lookups";
import { useAuth } from "@/hooks/useAuth";
import {
  type DedupeMatch,
  type EntityConfig,
  type ParsedSheet,
  type ResolvedRow,
  type UnresolvedRef,
  type WizardStepKey,
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  stepIndex,
} from "@/lib/hq/bulkImport/types";
import { UploadStep } from "./UploadStep";
import { MapStep, type MapStepValue } from "./MapStep";
import { DedupeStep } from "./DedupeStep";
import { ImportGrid } from "./ImportGrid";
import { CommitConfirm, type CommitSummary } from "./CommitConfirm";
import { StickyActionBar } from "./StickyActionBar";

type DraftPayload = {
  fileName: string | null;
  parsed: ParsedSheet | null;
  mappings: MapStepValue;
  dedupeDecisions: DedupeMatch[];
  gridRows: Record<string, unknown>[];
  columnSet: string[];
  step: WizardStepKey;
};

type DraftRow = {
  id: string;
  payload: DraftPayload;
  updated_at: string;
};

const AUTOSAVE_INTERVAL_MS = 20000;

export function BulkImportPage({
  config,
  resolveUnresolved,
  resolveDedupe,
  navigateOnComplete = "/settings",
}: {
  config: EntityConfig;
  /** Optional callback so per-entity hosts can pre-compute unresolved refs
   *  against the parsed sheet. 5.9.1 ships with a no-op (empty refs).      */
  resolveUnresolved?: (parsed: ParsedSheet) => UnresolvedRef[];
  /** Optional dedupe-matcher hook for entity hosts. 5.9.1 default = none.
   *  May be async (5.9.2 Project queries the live table). */
  resolveDedupe?: (rows: ResolvedRow[]) => DedupeMatch[] | Promise<DedupeMatch[]>;
  navigateOnComplete?: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Step + per-step state. All hooks live above any early return per
  // design-system § 12 rule 2 (hooks above any early return).
  const [step, setStep] = useState<WizardStepKey>("upload");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mappings, setMappings] = useState<MapStepValue>({});
  const [dedupeDecisions, setDedupeDecisions] = useState<DedupeMatch[]>([]);
  const [gridRows, setGridRows] = useState<Record<string, unknown>[]>([]);
  const [columnKeys, setColumnKeys] = useState<string[]>(config.defaultColumnKeys);
  const [committing, setCommitting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftBanner, setDraftBanner] = useState<DraftRow | null>(null);

  const isDirty =
    parsed !== null ||
    Object.keys(mappings).length > 0 ||
    dedupeDecisions.length > 0 ||
    gridRows.length > 0;

  const dirtyRef = useRef(isDirty);
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // Draft load on mount. Surfaces a Resume/Discard banner; user explicitly
  // chooses, no auto-rehydrate.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("bulk_import_drafts")
        .select("id, payload, updated_at")
        .eq("author", user.id)
        .eq("entity_type", config.entity_type)
        .maybeSingle();
      if (cancelled || error || !data) return;
      setDraftBanner(data as DraftRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, config.entity_type]);

  // Autosave every 20s while dirty.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      if (!dirtyRef.current) return;
      const payload: DraftPayload = {
        fileName,
        parsed,
        mappings,
        dedupeDecisions,
        gridRows,
        columnSet: columnKeys,
        step,
      };
      void supabase
        .from("bulk_import_drafts")
        .upsert(
          {
            author: user.id,
            entity_type: config.entity_type,
            payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "author,entity_type" },
        );
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [
    user,
    config.entity_type,
    fileName,
    parsed,
    mappings,
    dedupeDecisions,
    gridRows,
    columnKeys,
    step,
  ]);

  const unresolved = useMemo<UnresolvedRef[]>(() => {
    if (!parsed) return [];
    return resolveUnresolved ? resolveUnresolved(parsed) : [];
  }, [parsed, resolveUnresolved]);

  const resolvedRows = useMemo<ResolvedRow[]>(() => {
    if (!parsed) return [];
    return parsed.rows.map((values, row_index) => ({ row_index, values }));
  }, [parsed]);

  // Dedupe resolution may hit the DB (5.9.2 Project queries the live table),
  // so it runs in an effect rather than a sync memo. Resolved eagerly once the
  // sheet parses so the auto-skip decision is ready by the time the user
  // advances past Map.
  const [dedupeMatches, setDedupeMatches] = useState<DedupeMatch[]>([]);
  const [dedupeLoading, setDedupeLoading] = useState(false);
  useEffect(() => {
    if (resolvedRows.length === 0 || !resolveDedupe) {
      setDedupeMatches([]);
      return;
    }
    let cancelled = false;
    setDedupeLoading(true);
    Promise.resolve(resolveDedupe(resolvedRows))
      .then((m) => {
        if (!cancelled) setDedupeMatches(m);
      })
      .finally(() => {
        if (!cancelled) setDedupeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedRows, resolveDedupe]);

  const validationErrors = useMemo<
    { row_index: number; column: string; message: string }[]
  >(() => {
    if (!config.validateRows || gridRows.length === 0) return [];
    return config.validateRows(gridRows, mappings);
  }, [config, gridRows, mappings]);

  // Initialize dedupe decisions to skip (the default action) the first
  // time the user enters DedupeStep with a non-empty match set.
  useEffect(() => {
    if (dedupeMatches.length > 0 && dedupeDecisions.length === 0) {
      setDedupeDecisions(
        dedupeMatches.map((m) => ({ ...m, action: "skip" as const })),
      );
    }
  }, [dedupeMatches, dedupeDecisions.length]);

  // Initialize gridRows from resolvedRows when entering Review.
  useEffect(() => {
    if (step === "review" && gridRows.length === 0 && resolvedRows.length > 0) {
      setGridRows(resolvedRows.map((r) => r.values));
    }
  }, [step, gridRows.length, resolvedRows]);

  const commitSummary: CommitSummary = useMemo(() => {
    const skips = dedupeDecisions.filter((d) => d.action === "skip").length;
    const updates = dedupeDecisions.filter((d) => d.action === "update").length;
    const createdRefsByKind: Record<string, number> = {};
    for (const [kind, recs] of Object.entries(mappings)) {
      const newCount = Object.values(recs).filter((r) => r.selection === "").length;
      if (newCount > 0) createdRefsByKind[kind] = newCount;
    }
    return {
      rowsToCreate: Math.max(0, gridRows.length - skips - updates),
      rowsToUpdate: updates,
      rowsToSkip: skips,
      createdRefsByKind,
      hasValidationErrors: validationErrors.length > 0,
    };
  }, [gridRows, dedupeDecisions, mappings, validationErrors]);

  const canAdvance = useMemo(() => {
    if (step === "upload") return parsed !== null;
    if (step === "map") {
      for (const ref of unresolved) {
        const r = mappings[ref.kind]?.[ref.raw_value];
        if (!r || r.selection == null) return false;
      }
      return true;
    }
    if (step === "dedupe") return true;
    if (step === "review") return gridRows.length > 0 && validationErrors.length === 0;
    if (step === "commit") return true;
    return false;
  }, [step, parsed, unresolved, mappings, gridRows, validationErrors]);

  const goNext = async () => {
    const i = WIZARD_STEPS.indexOf(step);
    if (i === -1) return;
    if (step === "map" && dedupeMatches.length === 0) {
      // Auto-skip Dedupe when no matches. Toast the side-effect so the
      // admin knows it happened.
      toast({ title: "No duplicates found", description: "Skipped to review." });
      setStep("review");
      return;
    }
    if (step === "commit") {
      await runCommit();
      return;
    }
    setStep(WIZARD_STEPS[i + 1]);
  };

  const goBack = () => {
    const i = WIZARD_STEPS.indexOf(step);
    if (i <= 0) return;
    setStep(WIZARD_STEPS[i - 1]);
  };

  const runCommit = async () => {
    setCommitting(true);
    try {
      // Per-entity hosts own the payload shape (ref resolution, "_queued:N"
      // markers, pipe-split arrays, dedupe_action). Fall back to the raw
      // grid rows + a flat queued-refs map for the 5.9.1 smoke surface.
      let commitRows: Record<string, unknown>[] = gridRows;
      let queuedRefs: Record<string, Array<Record<string, unknown>>> = {};
      if (config.buildCommitPayload) {
        const payload = config.buildCommitPayload(gridRows, mappings, dedupeDecisions);
        commitRows = payload.rows;
        queuedRefs = payload.queued_refs;
      } else {
        for (const [kind, recs] of Object.entries(mappings)) {
          const queued = Object.values(recs)
            .filter((r) => r.selection === "")
            .map((r) => r.createFields);
          if (queued.length > 0) queuedRefs[kind] = queued;
        }
      }

      const { data, error } = await supabase.functions.invoke("bulk-import", {
        body: {
          entity_type: config.entity_type,
          mode: "commit",
          rows: commitRows,
          queued_refs: queuedRefs,
          column_set: columnKeys,
        },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = (await ctx.clone().json()) as { error?: string };
            if (body?.error) msg = `${ctx.status}: ${body.error}`;
          } catch {
            /* swallow */
          }
        }
        toast({ title: "Import failed", description: msg, variant: "destructive" });
        return;
      }

      const resp = data as {
        ok?: boolean;
        parsed_count?: number;
        created_ids?: string[];
        created_refs?: Record<string, number>;
        error?: string;
      };
      if (!resp?.ok) {
        toast({
          title: "Import failed",
          description: resp?.error ?? "Unknown error",
          variant: "destructive",
        });
        return;
      }

      // Handlers report the true created count via created_ids, so the toast
      // reflects exactly what was inserted (including 0 when every row was
      // skipped as a duplicate).
      const createdCount = resp.created_ids?.length ?? 0;
      const refSum = Object.values(resp.created_refs ?? {}).reduce(
        (s, n) => s + n,
        0,
      );
      toast({
        title: "Import complete",
        description:
          refSum > 0
            ? `Imported ${createdCount} record(s); ${refSum} new reference(s).`
            : `Imported ${createdCount} record(s).`,
      });

      // Bust the shared lookup caches: the commit RPC may have created
      // category / subcategory / capability / city rows server-side, which the
      // module-level cache never refetches on its own (see lookups.ts). Without
      // this, those new lookups stay invisible on the detail/edit surfaces (and
      // their dropdowns) until a full page reload.
      invalidateLookup();

      // Clear the draft after a successful commit.
      if (user) {
        await supabase
          .from("bulk_import_drafts")
          .delete()
          .eq("author", user.id)
          .eq("entity_type", config.entity_type);
      }

      navigate(navigateOnComplete);
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setCommitting(false);
    }
  };

  const onResumeDraft = () => {
    if (!draftBanner) return;
    const p = draftBanner.payload;
    setParsed(p.parsed);
    setFileName(p.fileName);
    setMappings(p.mappings ?? {});
    setDedupeDecisions(p.dedupeDecisions ?? []);
    setGridRows(p.gridRows ?? []);
    setColumnKeys(p.columnSet ?? config.defaultColumnKeys);
    setStep(p.step ?? "upload");
    setDraftBanner(null);
  };

  const onDiscardDraft = async () => {
    if (!user || !draftBanner) return;
    await supabase
      .from("bulk_import_drafts")
      .delete()
      .eq("id", draftBanner.id);
    setDraftBanner(null);
  };

  const onCancel = () => {
    if (isDirty) setCancelOpen(true);
    else navigate(navigateOnComplete);
  };

  const onConfirmCancel = async () => {
    if (user) {
      await supabase
        .from("bulk_import_drafts")
        .delete()
        .eq("author", user.id)
        .eq("entity_type", config.entity_type);
    }
    setCancelOpen(false);
    navigate(navigateOnComplete);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 pt-8 pb-28">
      <header className="space-y-2">
        {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}
        <h1 className="h-page">Bulk Import · {config.displayName}</h1>
        <p className="text-sm text-muted-foreground">{config.shortDescription}</p>
      </header>

      {draftBanner ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 p-4 text-sm">
          <div>
            You have an unfinished {config.displayName} import draft from{" "}
            {new Date(draftBanner.updated_at).toLocaleString()}.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="tlink" onClick={onResumeDraft}>
              Resume
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="tlink" onClick={onDiscardDraft}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <Stepper steps={WIZARD_STEP_LABELS} active={stepIndex(step)} />

      <div className="space-y-6">
        {step === "upload" ? (
          <UploadStep
            config={config}
            parsed={parsed}
            fileName={fileName}
            onParsed={(s, n) => {
              setParsed(s);
              setFileName(n);
            }}
          />
        ) : null}
        {step === "map" ? (
          <MapStep
            config={config}
            parsed={parsed!}
            unresolved={unresolved}
            value={mappings}
            onChange={setMappings}
          />
        ) : null}
        {step === "dedupe" ? (
          dedupeLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <DedupeStep
              config={config}
              rows={resolvedRows}
              matches={dedupeMatches}
              decisions={dedupeDecisions}
              onChange={setDedupeDecisions}
            />
          )
        ) : null}
        {step === "review" ? (
          <ImportGrid
            config={config}
            rows={gridRows}
            errors={validationErrors}
            columnKeys={columnKeys}
            onRowsChange={setGridRows}
            onColumnKeysChange={setColumnKeys}
          />
        ) : null}
        {step === "commit" ? <CommitConfirm config={config} summary={commitSummary} /> : null}
      </div>

      <StickyActionBar
        onBack={goBack}
        onNext={goNext}
        onCancel={onCancel}
        nextLabel={step === "commit" ? "Import" : "Next"}
        nextDisabled={!canAdvance}
        backDisabled={step === "upload"}
        loading={committing}
        dirty={isDirty}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this import?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Leaving will delete the in-flight draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmCancel}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
