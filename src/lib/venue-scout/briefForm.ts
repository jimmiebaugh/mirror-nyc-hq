// Phase 4.3-port + Phase 4 Revision: shared types + helpers for the Brief
// intake form. Lives in venue-scout/lib so the three intake pages (BriefEvent,
// BriefVenue, BriefReport) and any future surface can reuse the same shape.
//
// Storage layout:
//   - Named vs_scouts columns: client_name, event_name, live_dates, city,
//     budget, event_overview.
//   - Everything else lives under vs_scouts.brief_data jsonb. Form-backed
//     canonical keys (Phase 4 Revision; install/strike dates retired in
//     5.12.14.3; sq_ft_min + sq_ft_max retired in 5.12.14.3 R4 amendment v2):
//     expected_guest_count, activations_count, objectives, target_audience,
//     vibe_aesthetic, target_neighborhoods, strict_neighborhoods_only,
//     venue_types, sq_ft_minimum, ideal_features, priority_location,
//     priority_cost. Legacy sq_ft_min/sq_ft_max keys on existing scout rows
//     are orphaned but harmless (no reader; not back-filled here).
//   - Non-form keys ride along untouched in the brief_data passthrough:
//     uploaded_files (string[]), the *_started_at idempotency flags,
//     overview_source_hash (Phase 4 Revision pass 3: written by
//     vs-generate-brief-overview, read by Submit Brief to decide whether the
//     persisted overview is stale -- machine metadata, no form field, same
//     shape as the *_started_at flags), and the retired `notes` key (kept for
//     backward compat -- existing scouts that have notes keep them; new scouts
//     never write the key).
//
// fromScout strips the 12 form-backed keys out of the brief_data passthrough
// (they live in their own form fields); toUpdate rebuilds them from the form
// fields. That keeps fromScout(toUpdate(state)) === state a clean round-trip.

import type { Database } from "@/integrations/supabase/types";

type VsScoutRow = Database["public"]["Tables"]["vs_scouts"]["Row"];
type VsScoutUpdate = Database["public"]["Tables"]["vs_scouts"]["Update"];

export type PriorityLocation = "high_foot_traffic" | "intimate_destination";
export type PriorityCost = "lower_cost" | "premium";

/**
 * Local form-state shape for the whole 3-step intake. The form is one logical
 * entity across Event / Venue / Review steps. budget_text and
 * expected_guest_count are raw display strings so the producer can type
 * freely; both parse at save via toUpdate(). brief_data carries the jsonb
 * passthrough (uploaded_files + idempotency flags + legacy notes).
 */
export type BriefFormState = {
  // Existing named-column fields
  client_name: string;
  event_name: string;
  live_dates: string;
  city: string;
  budget_text: string;
  event_overview: string; // generated on Step 3, edited inline
  expected_guest_count: string;

  // Event step (brief_data keys)
  activations_count: number | null; // slider; null = TBD
  objectives: string[];
  // Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
  // string[] (tag-array shape matching objectives / target_neighborhoods /
  // venue_types / ideal_features). One demographic / aesthetic per tag.
  target_audience: string[];
  vibe_aesthetic: string[];

  // Venue step (brief_data keys)
  target_neighborhoods: string[];
  strict_neighborhoods_only: boolean;
  venue_types: string[]; // chip multi-select; arbitrary strings
  sq_ft_minimum: number | null; // slider; null = any
  ideal_features: string[];
  priority_location: PriorityLocation | null;
  priority_cost: PriorityCost | null;

  // Raw jsonb passthrough: uploaded_files, *_started_at flags, legacy notes.
  brief_data: Record<string, unknown>;
};

export const EMPTY_BRIEF_FORM: BriefFormState = {
  client_name: "",
  event_name: "",
  live_dates: "",
  city: "",
  budget_text: "",
  event_overview: "",
  expected_guest_count: "",
  activations_count: null,
  objectives: [],
  target_audience: [],
  vibe_aesthetic: [],
  target_neighborhoods: [],
  strict_neighborhoods_only: false,
  venue_types: [],
  sq_ft_minimum: null,
  ideal_features: [],
  priority_location: null,
  priority_cost: null,
  brief_data: {},
};

// brief_data keys hoisted into dedicated form fields. Stripped from the
// passthrough by fromScout, rebuilt by toUpdate.
const FORM_BACKED_BRIEF_DATA_KEYS = [
  "expected_guest_count",
  "activations_count",
  "objectives",
  "target_audience",
  "vibe_aesthetic",
  "target_neighborhoods",
  "strict_neighborhoods_only",
  "venue_types",
  "sq_ft_minimum",
  "ideal_features",
  "priority_location",
  "priority_cost",
] as const;

/**
 * Shape returned from vs-parse-brief. All fields optional -- the model fills
 * what it finds, the producer fills the rest. Named-column fields plus the
 * jsonb-key fields the model can reasonably infer from a PDF. Producer
 * judgment calls (priority toggles, strict-neighborhood flag, sq-ft sliders)
 * are intentionally NOT parsed.
 */
export type ParsedBriefFields = {
  // Existing
  client_name?: string | null;
  event_name?: string | null;
  live_dates?: string | null;
  city?: string | null;
  budget?: number | null;
  event_overview?: string | null;
  expected_guest_count?: number | null;
  additional_notes?: string | null; // KEEP for backward compat with v14; not surfaced

  // New (Phase 4 Revision)
  activations_count?: number | null;
  objectives?: string[] | null;
  // Phase 5.12.5: target_audience + vibe_aesthetic flipped to string[].
  // Matches the new vs-parse-brief schema shape + the BriefFormState shape.
  target_audience?: string[] | null;
  vibe_aesthetic?: string[] | null;
  target_neighborhoods?: string[] | null;
  venue_types?: string[] | null;
  ideal_features?: string[] | null;

  // Phase 5.12.13.7: multi-set live-dates options. Populated by vs-parse-brief
  // INSTEAD OF the singular live_dates field when a brief contains 2+ distinct
  // date sets for live dates (multi-city tours, multi-date offerings).
  // ParsedPreview renders these as a radio group and writes the producer's
  // pick into form state via the singular key. applyParsedFields does not
  // consume *_options directly; the UI resolves to a single string before
  // calling. (Install / strike dates retired in 5.12.14.3.)
  live_dates_options?: string[] | null;
};

/**
 * Format a numeric budget as a US-dollar display string. Null / undefined
 * comes back empty.
 *
 * R6 § D.2: `maximumFractionDigits: 0` flips decimals off so legacy persisted
 * values render with whole-dollar formatting consistent with the new typed
 * `$X,XXX` input mask on BriefEvent + BriefReport.
 */
function formatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Parse a producer-typed budget string back to a number. Strips $ / commas /
 * whitespace, parseFloat. Returns null when empty or unparseable.
 */
function parseBudget(text: string): number | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/[$,\s]/g, "");
  if (!stripped) return null;
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a producer-typed guest count back to an integer. Same canonical form
 * as `toUpdate` uses for the brief_data.expected_guest_count number.
 * Returns null when empty or unparseable.
 */
function parseGuestCount(text: string): number | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/**
 * Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
 * string[]. Read legacy strings as single-element arrays so existing scouts
 * surface their pre-5.12.5 content; on next save the array shape persists.
 * The § 5 backfill migration normalizes the live test scout at deploy time;
 * this helper stays as a defensive layer against future hand-edits (SQL
 * console, manual JSON injection).
 */
function normalizeTagArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return [v.trim()];
  }
  return [];
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asPriorityLocation(v: unknown): PriorityLocation | null {
  return v === "high_foot_traffic" || v === "intimate_destination" ? v : null;
}

function asPriorityCost(v: unknown): PriorityCost | null {
  return v === "lower_cost" || v === "premium" ? v : null;
}

/**
 * Build the form state from a vs_scouts row. The brief_data jsonb is split:
 * the 12 form-backed keys hoist into their own form fields; everything else
 * (uploaded_files, idempotency flags, legacy notes) stays under brief_data so
 * toUpdate round-trips it untouched.
 */
export function fromScout(row: VsScoutRow): BriefFormState {
  const briefData = (row.brief_data as Record<string, unknown> | null) ?? {};

  // Passthrough = brief_data minus the form-backed keys.
  const passthrough: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(briefData)) {
    if (!(FORM_BACKED_BRIEF_DATA_KEYS as readonly string[]).includes(k)) {
      passthrough[k] = v;
    }
  }

  return {
    client_name: row.client_name ?? "",
    event_name: row.event_name ?? "",
    live_dates: row.live_dates ?? "",
    city: row.city ?? "",
    budget_text: formatBudget(row.budget),
    event_overview: row.event_overview ?? "",
    expected_guest_count: asString(briefData.expected_guest_count),
    activations_count: asNumberOrNull(briefData.activations_count),
    objectives: asStringArray(briefData.objectives),
    target_audience: normalizeTagArray(briefData.target_audience),
    vibe_aesthetic: normalizeTagArray(briefData.vibe_aesthetic),
    target_neighborhoods: asStringArray(briefData.target_neighborhoods),
    strict_neighborhoods_only: briefData.strict_neighborhoods_only === true,
    venue_types: asStringArray(briefData.venue_types),
    // R6 § M.2: legacy `sq_ft_min` falls back to the new `sq_ft_minimum`
    // slot at read time so scouts created before R4 amendment v2 still feed
    // the size-floor veto + AI sourcing prompt. The legacy `sq_ft_min` jsonb
    // key stays orphaned on the row; this fallback only fires when
    // `sq_ft_minimum` is absent.
    sq_ft_minimum:
      asNumberOrNull(briefData.sq_ft_minimum) ??
      asNumberOrNull(briefData.sq_ft_min),
    ideal_features: asStringArray(briefData.ideal_features),
    priority_location: asPriorityLocation(briefData.priority_location),
    priority_cost: asPriorityCost(briefData.priority_cost),
    brief_data: passthrough,
  };
}

/**
 * Build the vs_scouts UPDATE payload from form state. Reassembles brief_data
 * jsonb from the passthrough plus the 12 form-backed keys. Empty strings /
 * empty arrays / nulls drop their key so the jsonb doesn't fill with blanks;
 * strict_neighborhoods_only is always written (false is a meaningful value).
 * Numeric budget + guest-count parsing happens here.
 */
export function toUpdate(state: BriefFormState): VsScoutUpdate {
  const bd: Record<string, unknown> = { ...state.brief_data };

  const setOrDelete = (key: string, value: unknown, keep: boolean) => {
    if (keep) bd[key] = value;
    else delete bd[key];
  };

  // expected_guest_count: parse as integer when possible.
  const egcText = state.expected_guest_count.trim();
  if (egcText) {
    const egcNum = parseInt(egcText.replace(/[,\s]/g, ""), 10);
    setOrDelete("expected_guest_count", egcNum, Number.isFinite(egcNum));
  } else {
    delete bd.expected_guest_count;
  }

  setOrDelete(
    "activations_count",
    state.activations_count,
    state.activations_count !== null,
  );

  setOrDelete("objectives", state.objectives, state.objectives.length > 0);

  setOrDelete(
    "target_audience",
    state.target_audience,
    state.target_audience.length > 0,
  );

  setOrDelete(
    "vibe_aesthetic",
    state.vibe_aesthetic,
    state.vibe_aesthetic.length > 0,
  );

  setOrDelete(
    "target_neighborhoods",
    state.target_neighborhoods,
    state.target_neighborhoods.length > 0,
  );

  // strict_neighborhoods_only: always written; false is meaningful.
  bd.strict_neighborhoods_only = state.strict_neighborhoods_only;

  setOrDelete("venue_types", state.venue_types, state.venue_types.length > 0);

  setOrDelete("sq_ft_minimum", state.sq_ft_minimum, state.sq_ft_minimum !== null);

  setOrDelete(
    "ideal_features",
    state.ideal_features,
    state.ideal_features.length > 0,
  );

  setOrDelete(
    "priority_location",
    state.priority_location,
    state.priority_location !== null,
  );
  setOrDelete("priority_cost", state.priority_cost, state.priority_cost !== null);

  return {
    client_name: state.client_name.trim() || null,
    event_name: state.event_name.trim() || null,
    live_dates: state.live_dates.trim() || null,
    city: state.city.trim() || null,
    budget: parseBudget(state.budget_text),
    event_overview: state.event_overview.trim() || null,
    // deno-lint-ignore no-explicit-any
    brief_data: bd as any,
  };
}

/**
 * Merge unique string values into an existing list, preserving order and the
 * producer's already-typed entries. Used for the array fields parsed from a
 * PDF (objectives, neighborhoods, venue_types, ideal_features).
 */
function mergeUnique(existing: string[], incoming: string[]): string[] {
  const out = [...existing];
  for (const v of incoming) {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Merge parsed-from-PDF fields into a form state. Named-column + scalar fields
 * overwrite when the parsed value is non-empty (the producer reviews the
 * ParsedPreview before clicking Apply). Array fields merge-unique so a
 * producer's already-typed tags survive. Empty / null / undefined parsed
 * values are ignored. Producer judgment fields (priority toggles, strict
 * flag, sq-ft sliders) are never parsed and stay untouched.
 */
export function applyParsedFields(
  state: BriefFormState,
  parsed: ParsedBriefFields,
): BriefFormState {
  const next: BriefFormState = { ...state, brief_data: { ...state.brief_data } };

  // Phase 5.12.5: re-parse guard for client_name + event_name. The server-side
  // guard in vs-parse-brief drops the field from parsed_fields when the scout
  // already has a value; this client-side check is the second layer + covers
  // the (very unlikely) case where the form state in memory has a value but
  // the persisted scout row didn't.
  if (parsed.client_name?.trim() && !state.client_name.trim()) {
    next.client_name = parsed.client_name.trim();
  }
  if (parsed.event_name?.trim() && !state.event_name.trim()) {
    next.event_name = parsed.event_name.trim();
  }
  if (parsed.live_dates?.trim()) next.live_dates = parsed.live_dates.trim();
  if (parsed.city?.trim()) next.city = parsed.city.trim();
  if (typeof parsed.budget === "number" && Number.isFinite(parsed.budget)) {
    next.budget_text = formatBudget(parsed.budget);
  }
  if (parsed.event_overview?.trim()) {
    next.event_overview = parsed.event_overview.trim();
  }
  if (
    typeof parsed.expected_guest_count === "number" &&
    Number.isFinite(parsed.expected_guest_count)
  ) {
    next.expected_guest_count = String(Math.round(parsed.expected_guest_count));
  }

  // R6 § M.10: only apply activations_count when the parsed value is
  // strictly positive. A returned 0 / negative reads as "no signal" and
  // shouldn't overwrite a producer-set value (or render as a literal "0"
  // in the display cell).
  if (
    typeof parsed.activations_count === "number" &&
    Number.isFinite(parsed.activations_count) &&
    parsed.activations_count > 0
  ) {
    next.activations_count = Math.round(parsed.activations_count);
  }
  if (Array.isArray(parsed.target_audience)) {
    next.target_audience = mergeUnique(next.target_audience, parsed.target_audience);
  }
  if (Array.isArray(parsed.vibe_aesthetic)) {
    next.vibe_aesthetic = mergeUnique(next.vibe_aesthetic, parsed.vibe_aesthetic);
  }

  if (Array.isArray(parsed.objectives)) {
    next.objectives = mergeUnique(next.objectives, parsed.objectives);
  }
  if (Array.isArray(parsed.target_neighborhoods)) {
    next.target_neighborhoods = mergeUnique(
      next.target_neighborhoods,
      parsed.target_neighborhoods,
    );
  }
  if (Array.isArray(parsed.venue_types)) {
    next.venue_types = mergeUnique(next.venue_types, parsed.venue_types);
  }
  if (Array.isArray(parsed.ideal_features)) {
    next.ideal_features = mergeUnique(next.ideal_features, parsed.ideal_features);
  }

  return next;
}

/**
 * Append a storage path to brief_data.uploaded_files. Used after a successful
 * PDF upload + parse so the original document stays referenceable for
 * downstream consumers (re-parse, audit). Deduped to avoid double-recording.
 */
export function appendUploadedFile(
  state: BriefFormState,
  storagePath: string,
): BriefFormState {
  const existing = Array.isArray(state.brief_data.uploaded_files)
    ? (state.brief_data.uploaded_files as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  if (existing.includes(storagePath)) return state;
  return {
    ...state,
    brief_data: {
      ...state.brief_data,
      uploaded_files: [...existing, storagePath],
    },
  };
}

/**
 * Deterministic client-side fallback for the Event Overview. Mirrors the edge
 * function's own stub (vs-generate-brief-overview `buildStub`) for the case
 * where the invoke fails before the function can run. Used by Submit Brief
 * (BriefVenue) and the report's regenerate path (BriefReport).
 */
export function buildOverviewStub(state: BriefFormState): string {
  const where = state.city.trim() ? ` in ${state.city.trim()}` : "";
  const live = state.live_dates.trim()
    ? ` Live ${state.live_dates.trim()}.`
    : "";
  return `${state.event_name.trim() || "Event"} for ${
    state.client_name.trim() || "the client"
  }${where}.${live}`;
}

/**
 * Stable hash of the brief fields that drive the Event Overview prompt.
 * Used by Submit Brief (client) and vs-generate-brief-overview (server)
 * to decide whether the overview is stale.
 *
 * Arrays are sorted before serialization so reordering tags does not
 * count as a change. Strings are trimmed. Numbers are passed through.
 * null and "" both serialize to JSON null so an empty field reads as
 * "no value" regardless of typing.
 *
 * The 15 inputs are the same fields vs-generate-brief-overview feeds into the
 * overview prompt. The server recomputes this hash from the persisted scout
 * row, so the field set, the canonical form of each field, AND the object key
 * order must stay in lockstep with the server implementation.
 *
 * Returns a 16-character hex prefix of the SHA-256 digest.
 */
export async function computeOverviewSourceHash(
  state: BriefFormState,
): Promise<string> {
  const normalize = (v: string) => v.trim() || null;
  // Phase 5.1 NIT pickup: budget + expected_guest_count are hashed in their
  // canonical numeric form so a producer who types a non-canonical input
  // (no `$`, no commas) doesn't trigger a wasted regen on re-submit. The
  // server-side hash in vs-generate-brief-overview applies the same shape.
  const source = {
    client_name: normalize(state.client_name),
    event_name: normalize(state.event_name),
    live_dates: normalize(state.live_dates),
    city: normalize(state.city),
    budget: parseBudget(state.budget_text),
    expected_guest_count: parseGuestCount(state.expected_guest_count),
    activations_count: state.activations_count,
    objectives: [...state.objectives].sort(),
    // Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
    // string[]; hash uses sorted array shape (matches objectives /
    // target_neighborhoods / venue_types / ideal_features). Object key order
    // and shape must stay in lockstep with the server-side hash in
    // supabase/functions/vs-generate-brief-overview/index.ts.
    target_audience: [...state.target_audience].sort(),
    vibe_aesthetic: [...state.vibe_aesthetic].sort(),
    target_neighborhoods: [...state.target_neighborhoods].sort(),
    venue_types: [...state.venue_types].sort(),
    ideal_features: [...state.ideal_features].sort(),
  };
  const json = JSON.stringify(source);
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
