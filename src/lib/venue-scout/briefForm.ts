// Phase 4.3-port: shared types + helpers for the Brief page form. Lives in
// venue-scout/lib so future surfaces (Scout Settings, Scout Dashboard) can
// reuse the same shape for read-only display or partial edits.
//
// Storage layout (port plan § 8.2):
//   - Named vs_scouts columns: client_name, event_name, live_dates, city,
//     budget, event_overview.
//   - Everything else lives under vs_scouts.brief_data jsonb. Canonical keys
//     consumed downstream: expected_guest_count (number), notes (string),
//     uploaded_files (string[] of storage paths). Any additional key the
//     producer adds via the parsed-fields apply step rides along inside
//     brief_data and gets seen by downstream prompts that stringify the
//     entire jsonb into context.

import type { Database } from "@/integrations/supabase/types";

type VsScoutRow = Database["public"]["Tables"]["vs_scouts"]["Row"];
type VsScoutUpdate = Database["public"]["Tables"]["vs_scouts"]["Update"];

/**
 * Local form-state shape. budget_text / expected_guest_count are stored as
 * raw display strings so the producer can type freely; both parse at save
 * via toUpdate(). brief_data carries the full jsonb the form writes back --
 * notes + expected_guest_count + uploaded_files at minimum, plus any extra
 * keys parsed from a PDF.
 */
export type BriefFormState = {
  client_name: string;
  event_name: string;
  live_dates: string;
  city: string;
  budget_text: string;
  expected_guest_count: string;
  event_overview: string;
  brief_data_notes: string;
  brief_data: Record<string, unknown>;
};

export const EMPTY_BRIEF_FORM: BriefFormState = {
  client_name: "",
  event_name: "",
  live_dates: "",
  city: "",
  budget_text: "",
  expected_guest_count: "",
  event_overview: "",
  brief_data_notes: "",
  brief_data: {},
};

/**
 * Shape returned from vs-parse-brief. All fields optional -- the model fills
 * what it finds, the producer fills the rest. Named-column fields land at
 * the top level; jsonb-key fields nest under `brief_data` so the apply
 * helper merges them into the right slot.
 */
export type ParsedBriefFields = {
  client_name?: string | null;
  event_name?: string | null;
  live_dates?: string | null;
  city?: string | null;
  budget?: number | null;
  event_overview?: string | null;
  expected_guest_count?: number | null;
  additional_notes?: string | null;
};

/**
 * Format a numeric budget as a US-dollar display string. Null / undefined
 * comes back empty; values pre-formatted by the producer (with $ / commas)
 * survive parse → format roundtrip if the underlying number didn't change.
 */
function formatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Parse a producer-typed budget string back to a number. Strips $ / commas
 * / whitespace, parseFloat. Returns null when empty or unparseable.
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
 * Build the form state from a vs_scouts row. brief_data jsonb is read once
 * and split: the form's named jsonb-key fields (notes, expected_guest_count)
 * get hoisted into their own form fields; everything else stays under
 * brief_data so the round-trip preserves it.
 */
export function fromScout(row: VsScoutRow): BriefFormState {
  const briefData = (row.brief_data as Record<string, unknown> | null) ?? {};

  // Pull canonical keys out for dedicated form fields. Rest stays in
  // brief_data and rides along through toUpdate().
  const expectedGuestCount = briefData.expected_guest_count;
  const notes = briefData.notes;

  return {
    client_name: row.client_name ?? "",
    event_name: row.event_name ?? "",
    live_dates: row.live_dates ?? "",
    city: row.city ?? "",
    budget_text: formatBudget(row.budget),
    expected_guest_count:
      typeof expectedGuestCount === "number"
        ? String(expectedGuestCount)
        : typeof expectedGuestCount === "string"
        ? expectedGuestCount
        : "",
    event_overview: row.event_overview ?? "",
    brief_data_notes: typeof notes === "string" ? notes : "",
    brief_data: briefData,
  };
}

/**
 * Build the vs_scouts UPDATE payload from form state. Reassembles brief_data
 * jsonb with the form-controlled keys (notes, expected_guest_count) plus
 * whatever else was carried along in form.brief_data. Empty strings convert
 * to null for nullable text columns so the DB doesn't grow rows full of "".
 * Numeric budget parsing happens here; unparseable text stores null.
 */
export function toUpdate(state: BriefFormState): VsScoutUpdate {
  const nextBriefData: Record<string, unknown> = { ...state.brief_data };

  // notes: store when non-empty, drop the key entirely when empty so the
  // jsonb shape stays clean.
  const notes = state.brief_data_notes.trim();
  if (notes) {
    nextBriefData.notes = notes;
  } else {
    delete nextBriefData.notes;
  }

  // expected_guest_count: parse as integer when possible.
  const egcText = state.expected_guest_count.trim();
  if (egcText) {
    const egcNum = parseInt(egcText.replace(/[,\s]/g, ""), 10);
    if (Number.isFinite(egcNum)) {
      nextBriefData.expected_guest_count = egcNum;
    } else {
      delete nextBriefData.expected_guest_count;
    }
  } else {
    delete nextBriefData.expected_guest_count;
  }

  // Note: client_name / event_name are required at the form level; we still
  // send the trimmed value rather than null so the DB columns mirror the
  // user's intent.
  return {
    client_name: state.client_name.trim() || null,
    event_name: state.event_name.trim() || null,
    live_dates: state.live_dates.trim() || null,
    city: state.city.trim() || null,
    budget: parseBudget(state.budget_text),
    event_overview: state.event_overview.trim() || null,
    // deno-lint-ignore no-explicit-any
    brief_data: nextBriefData as any,
  };
}

/**
 * Merge parsed-from-PDF fields into a form state. Named-column fields
 * overwrite their form slot; jsonb-key fields land in brief_data / their
 * surfaced form field (notes, expected_guest_count). Empty / null / undefined
 * parsed values are ignored so the producer's existing entries don't get
 * clobbered with blanks.
 */
export function applyParsedFields(
  state: BriefFormState,
  parsed: ParsedBriefFields,
): BriefFormState {
  const next: BriefFormState = { ...state, brief_data: { ...state.brief_data } };

  if (parsed.client_name && parsed.client_name.trim()) {
    next.client_name = parsed.client_name.trim();
  }
  if (parsed.event_name && parsed.event_name.trim()) {
    next.event_name = parsed.event_name.trim();
  }
  if (parsed.live_dates && parsed.live_dates.trim()) {
    next.live_dates = parsed.live_dates.trim();
  }
  if (parsed.city && parsed.city.trim()) {
    next.city = parsed.city.trim();
  }
  if (typeof parsed.budget === "number" && Number.isFinite(parsed.budget)) {
    next.budget_text = formatBudget(parsed.budget);
  }
  if (parsed.event_overview && parsed.event_overview.trim()) {
    next.event_overview = parsed.event_overview.trim();
  }
  if (
    typeof parsed.expected_guest_count === "number" &&
    Number.isFinite(parsed.expected_guest_count)
  ) {
    next.expected_guest_count = String(Math.round(parsed.expected_guest_count));
  }
  if (parsed.additional_notes && parsed.additional_notes.trim()) {
    // Append to any existing notes rather than clobber -- producer may have
    // already typed something before uploading the PDF.
    const existing = next.brief_data_notes.trim();
    next.brief_data_notes = existing
      ? `${existing}\n\n${parsed.additional_notes.trim()}`
      : parsed.additional_notes.trim();
  }

  return next;
}

/**
 * Append a storage path to brief_data.uploaded_files. Used after a
 * successful PDF upload + parse so the original document remains
 * referenceable for downstream consumers (re-parse, audit, future Edit
 * Brief screen). Deduped to avoid double-recording the same path.
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
