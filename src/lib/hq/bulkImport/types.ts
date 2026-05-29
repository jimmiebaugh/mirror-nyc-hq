// Shared types for the bulk-import primitive (Phase 5.9.1). Consumed by
// every UI step + the entity registry. Per-entity sub-phases
// (5.9.2 / .3 / .4) declare an EntityConfig + register it.

export type EntityType = "project" | "vendor" | "venue";

export type ColumnKind =
  | "text"
  | "longText"
  | "number"
  | "money"
  | "date"
  | "enum"
  | "lookup"
  | "refResolved";

export type ColumnSection =
  | "Required"
  | "Essentials"
  | "Dates & Phases"
  | "References"
  | "Folders & Links"
  | "About Venue"
  | "Notes";

export type ColumnSchema = {
  key: string;
  label: string;
  kind: ColumnKind;
  section: ColumnSection;
  required?: boolean;
  /** For `enum` columns: the closed value set. */
  enumValues?: readonly string[];
  /** For `lookup` and `refResolved` columns: the ref kind key. */
  refKind?: string;
  /**
   * Phase 5.9.2: pipe-separated multi-value column (e.g. tags, venue).
   * Drives both the unresolved-ref enumeration (each token resolved
   * separately) and the commit-payload array split.
   */
  multiValue?: boolean;
  /**
   * For `lookup` columns: the shared lookup table whose existing values
   * power the cell's autocomplete suggestions (free text still allowed;
   * novel values auto-create server-side in the commit RPC).
   */
  lookupTable?: string;
};

export type UnresolvedRefCreateField = {
  key: string;
  label: string;
  kind: "text" | "longText" | "lookup" | "refResolved";
  required?: boolean;
  refKind?: string;
};

export type UnresolvedRefConfig = {
  kind: string;
  /** Human label for the group header on the Map step. */
  label: string;
  /** Table the typeahead resolver queries (clients / venues / users). */
  resolverTable: string;
  /**
   * Phase 5.9.2: how MapStep matches + resolves a raw value.
   *   - "name"  (default): match by `lower(name)`; selection is the record id.
   *     Supports queue-on-create (inline mini-create) when allowCreate.
   *   - "email": match by exact email against active users; selection is the
   *     email itself (the RPC resolves email -> user). No inline create.
   */
  resolverMode?: "name" | "email";
  /** When false, the "Create new" / queue affordance is hidden (users). */
  allowCreate?: boolean;
  /** Field shape for the inline mini-create form. */
  createFields: UnresolvedRefCreateField[];
  /** Other ref kinds whose resolution must precede this one. */
  dependsOn?: string[];
};

export type UnresolvedRef = {
  kind: string;
  raw_value: string;
  row_indices: number[];
};

export type ResolvedRow = {
  row_index: number;
  values: Record<string, unknown>;
};

export type DedupeMatch = {
  row_index: number;
  match_id: string;
  match_label: string;
  action: "skip" | "update" | "create";
};

export type EntityHandlerResult = {
  ok: boolean;
  created_ids: string[];
  created_refs: Record<string, number>;
  /**
   * Phase 5.9.2: set by handlers backed by a SECURITY DEFINER RPC that owns
   * the bulk_import_sessions write inside its own transaction. Documents the
   * contract for the edge function (TypeScript only; the edge function reads
   * the JSON envelope directly). When present, the edge function skips its
   * own session + activity_log inserts.
   */
  session_id?: string;
  errors?: Array<{ row_index: number; column: string; message: string }>;
};

/**
 * Phase 5.9.2: a single MapStep resolution for one distinct raw ref value.
 * Shared between MapStep (writer) and the per-entity buildCommitPayload
 * (reader) so the queued / mapped semantics stay in lockstep.
 */
export type RefResolution = {
  raw_value: string;
  /**
   * - null  = unresolved (blocks advance)
   * - ""    = queued for inline create (payload emits "_queued:N")
   * - other = mapped value: record id (name-mode) or email (email-mode)
   */
  selection: string | null;
  /** Inline-create field values when selection === "". */
  createFields: Record<string, string>;
};

export type RefMappings = Record<string, Record<string, RefResolution>>;

export type CommitPayload = {
  rows: Record<string, unknown>[];
  queued_refs: Record<string, Array<Record<string, string>>>;
};

export type RowValidationError = {
  row_index: number;
  column: string;
  message: string;
};

export type EntityConfig = {
  entity_type: EntityType;
  displayName: string;
  shortDescription: string;
  templateFilename?: string;
  columns: ColumnSchema[];
  unresolvedRefConfig: Record<string, UnresolvedRefConfig>;
  /**
   * Stable list of column keys that should render by default in the
   * ImportGrid when the admin has no saved column preference yet.
   */
  defaultColumnKeys: string[];
  /**
   * Pure function over a parsed row that returns the best dedupe key for
   * matching against existing records. Per-entity logic decides which
   * fields make a duplicate.
   */
  dedupeKey: (row: Record<string, unknown>) => string | null;

  // --- Phase 5.9.2 entity hooks (optional; the smoke surface uses none) ---
  //
  // These three hooks let the generic BulkImportPage host stay entity-agnostic
  // while each registered entity owns its resolution + payload shape. Locked
  // as the convention here; 5.9.3 (Vendor) + 5.9.4 (Venue) implement the same
  // three. See COWORK_SYNC carry-forwards.

  /**
   * Enumerate every distinct ref value in the parsed sheet, grouped by ref
   * kind. Multi-value columns are split on "|" so each token resolves
   * independently. Sync (no DB) — the async match happens in MapStep.
   */
  buildUnresolved?: (parsed: ParsedSheet) => UnresolvedRef[];

  /**
   * Query the live table for dedupe matches against the parsed rows. Async
   * (hits the DB). The RPC re-runs the match inside the transaction so a
   * record created between preview + commit can't slip through.
   */
  buildDedupe?: (rows: ResolvedRow[]) => Promise<DedupeMatch[]>;

  /**
   * Translate grid rows + MapStep resolutions + dedupe decisions into the RPC
   * payload shape (resolved refs, "_queued:N" markers, pipe-split arrays,
   * per-row dedupe_action) + the queued_refs map.
   */
  buildCommitPayload?: (
    gridRows: Record<string, unknown>[],
    mappings: RefMappings,
    decisions: DedupeMatch[],
  ) => CommitPayload;

  /**
   * Last-line client-side validation over the grid rows + resolutions.
   * Returns per-cell errors surfaced in ImportGrid + blocks commit.
   */
  validateRows?: (
    gridRows: Record<string, unknown>[],
    mappings: RefMappings,
  ) => RowValidationError[];
};

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  warnings: string[];
};

export type BulkImportDraftPayload = {
  fileName: string | null;
  parsed: ParsedSheet | null;
  mappings: Record<string, Record<string, string | null>>;
  dedupeDecisions: DedupeMatch[];
  gridEdits: Record<string, unknown>[];
  columnSet: string[];
  step: WizardStepKey;
};

export type WizardStepKey =
  | "upload"
  | "map"
  | "dedupe"
  | "review"
  | "commit";

export const WIZARD_STEPS: readonly WizardStepKey[] = [
  "upload",
  "map",
  "dedupe",
  "review",
  "commit",
];

export const WIZARD_STEP_LABELS: readonly string[] = [
  "Upload",
  "Map",
  "Dedupe",
  "Review",
  "Commit",
];

export function stepIndex(step: WizardStepKey): number {
  return WIZARD_STEPS.indexOf(step) + 1;
}
