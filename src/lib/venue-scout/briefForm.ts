// Phase 4.3-port + Phase 4 Revision: shared types + helpers for the Brief
// intake form. Lives in venue-scout/lib so the three intake pages (BriefEvent,
// BriefVenue, BriefReport) and any future surface can reuse the same shape.
//
// Storage layout:
//   - Named vs_scouts columns: client_name, event_name, live_dates, city,
//     budget, event_overview.
//   - Everything else lives under vs_scouts.brief_data jsonb. Form-backed
//     canonical keys (Phase 4 Revision): expected_guest_count, install_dates,
//     strike_dates, activations_count, objectives, target_audience,
//     vibe_aesthetic, target_neighborhoods, strict_neighborhoods_only,
//     venue_types, sq_ft_min, sq_ft_max, sq_ft_minimum, ideal_features,
//     priority_location, priority_cost.
//   - Non-form keys ride along untouched in the brief_data passthrough:
//     uploaded_files (string[]), the *_started_at idempotency flags, and the
//     retired `notes` key (kept for backward compat -- existing scouts that
//     have notes keep them; new scouts never write the key).
//
// fromScout strips the 16 form-backed keys out of the brief_data passthrough
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
  install_dates: string;
  strike_dates: string;
  activations_count: number | null; // slider; null = TBD
  objectives: string[];
  target_audience: string;
  vibe_aesthetic: string;

  // Venue step (brief_data keys)
  target_neighborhoods: string[];
  strict_neighborhoods_only: boolean;
  venue_types: string[]; // chip multi-select; arbitrary strings
  sq_ft_min: number | null; // slider; null = any
  sq_ft_max: number | null; // slider; null = any (10000+ stored as null)
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
  install_dates: "",
  strike_dates: "",
  activations_count: null,
  objectives: [],
  target_audience: "",
  vibe_aesthetic: "",
  target_neighborhoods: [],
  strict_neighborhoods_only: false,
  venue_types: [],
  sq_ft_min: null,
  sq_ft_max: null,
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
  "install_dates",
  "strike_dates",
  "activations_count",
  "objectives",
  "target_audience",
  "vibe_aesthetic",
  "target_neighborhoods",
  "strict_neighborhoods_only",
  "venue_types",
  "sq_ft_min",
  "sq_ft_max",
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
  install_dates?: string | null;
  strike_dates?: string | null;
  activations_count?: number | null;
  objectives?: string[] | null;
  target_audience?: string | null;
  vibe_aesthetic?: string | null;
  target_neighborhoods?: string[] | null;
  venue_types?: string[] | null;
  ideal_features?: string[] | null;
};

/**
 * Format a numeric budget as a US-dollar display string. Null / undefined
 * comes back empty.
 */
function formatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
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
 * the 16 form-backed keys hoist into their own form fields; everything else
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
    install_dates: asString(briefData.install_dates),
    strike_dates: asString(briefData.strike_dates),
    activations_count: asNumberOrNull(briefData.activations_count),
    objectives: asStringArray(briefData.objectives),
    target_audience: asString(briefData.target_audience),
    vibe_aesthetic: asString(briefData.vibe_aesthetic),
    target_neighborhoods: asStringArray(briefData.target_neighborhoods),
    strict_neighborhoods_only: briefData.strict_neighborhoods_only === true,
    venue_types: asStringArray(briefData.venue_types),
    sq_ft_min: asNumberOrNull(briefData.sq_ft_min),
    sq_ft_max: asNumberOrNull(briefData.sq_ft_max),
    sq_ft_minimum: asNumberOrNull(briefData.sq_ft_minimum),
    ideal_features: asStringArray(briefData.ideal_features),
    priority_location: asPriorityLocation(briefData.priority_location),
    priority_cost: asPriorityCost(briefData.priority_cost),
    brief_data: passthrough,
  };
}

/**
 * Build the vs_scouts UPDATE payload from form state. Reassembles brief_data
 * jsonb from the passthrough plus the 16 form-backed keys. Empty strings /
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

  const installDates = state.install_dates.trim();
  setOrDelete("install_dates", installDates, installDates.length > 0);

  const strikeDates = state.strike_dates.trim();
  setOrDelete("strike_dates", strikeDates, strikeDates.length > 0);

  setOrDelete(
    "activations_count",
    state.activations_count,
    state.activations_count !== null,
  );

  setOrDelete("objectives", state.objectives, state.objectives.length > 0);

  const targetAudience = state.target_audience.trim();
  setOrDelete("target_audience", targetAudience, targetAudience.length > 0);

  const vibeAesthetic = state.vibe_aesthetic.trim();
  setOrDelete("vibe_aesthetic", vibeAesthetic, vibeAesthetic.length > 0);

  setOrDelete(
    "target_neighborhoods",
    state.target_neighborhoods,
    state.target_neighborhoods.length > 0,
  );

  // strict_neighborhoods_only: always written; false is meaningful.
  bd.strict_neighborhoods_only = state.strict_neighborhoods_only;

  setOrDelete("venue_types", state.venue_types, state.venue_types.length > 0);

  setOrDelete("sq_ft_min", state.sq_ft_min, state.sq_ft_min !== null);
  setOrDelete("sq_ft_max", state.sq_ft_max, state.sq_ft_max !== null);
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

  if (parsed.client_name?.trim()) next.client_name = parsed.client_name.trim();
  if (parsed.event_name?.trim()) next.event_name = parsed.event_name.trim();
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

  if (parsed.install_dates?.trim()) next.install_dates = parsed.install_dates.trim();
  if (parsed.strike_dates?.trim()) next.strike_dates = parsed.strike_dates.trim();
  if (
    typeof parsed.activations_count === "number" &&
    Number.isFinite(parsed.activations_count)
  ) {
    next.activations_count = Math.round(parsed.activations_count);
  }
  if (parsed.target_audience?.trim()) {
    next.target_audience = parsed.target_audience.trim();
  }
  if (parsed.vibe_aesthetic?.trim()) {
    next.vibe_aesthetic = parsed.vibe_aesthetic.trim();
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
