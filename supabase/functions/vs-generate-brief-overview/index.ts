// vs-generate-brief-overview (Phase 4 Revision - Intake; v2 = pass 3)
//
// Generates the Event Overview paragraph for a Venue Scout brief.
//
// Trigger model (pass 3): the primary trigger is the Submit Brief click in
// BriefVenue.tsx, which invokes this only when the overview is missing or the
// brief fields that drive it changed since the last generation. BriefReport's
// empty-state Generate button and Regenerate link invoke it unconditionally.
//
// Signature:
//   POST { scout_id: string }
//     -> { event_overview: string, overview_source_hash: string }
//
// Flow:
//   1. Validate scout_id (UUID).
//   2. Load the scout's brief fields via the service-role client.
//   3. Build a context block from the named columns + the Phase 4 Revision
//      brief_data keys and ask Claude (via callClaude('venue_scout')) for a
//      3-5 sentence overview in Mirror's voice.
//   4. Compute overview_source_hash from the same brief fields. MUST stay in
//      lockstep with briefForm.ts computeOverviewSourceHash (same field set,
//      same canonical form, same object key order).
//   5. Atomically write event_overview + brief_data.overview_source_hash back
//      to the scout in a single UPDATE, return both.
//
// Failure mode: if Claude errors or returns empty, fall back to a
// deterministic stub and persist that instead, so the producer always lands
// on a non-empty, editable overview. The hash is written regardless so the
// caller can record that this overview reflects the current brief fields.
//
// Auth posture: verify_jwt = true (default). User-invoked synchronous from
// the Brief surface; no self-invoke, no internal-secret path. Matches the
// vs-parse-brief sibling pattern. Spend tracking flows through
// callClaude('venue_scout').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude } from "../_shared/anthropic.ts";

// User-invoked synchronous only; no internal-secret path. Don't advertise
// x-internal-secret to the browser preflight.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Voice rules baked from ABOUT ME/anti-ai-writing-style.md: no em dashes, no
// filler affirmations, concise prose paragraphs.
const SYSTEM_PROMPT = [
  "You write the Event Overview paragraph for a venue-sourcing brief at Mirror NYC, an experiential agency that produces brand activations, launches, and pop-ups.",
  "Given the brief fields below, write a single tight overview of 3 to 5 sentences that captures what the activation is, who it's for, and the vibe the venue should carry.",
  "",
  "Voice rules (follow exactly):",
  "- No em dashes anywhere. Use commas, periods, or parentheses.",
  "- No filler affirmations or hype ('exciting', 'amazing', 'we're thrilled').",
  "- Plain, direct prose. One paragraph, no bullet points, no headings.",
  "- Concise. Say what matters and stop. 3 to 5 sentences.",
  "- Only use what the brief gives you. Don't invent specifics that aren't there.",
  "",
  "Return ONLY the overview paragraph. No preamble, no quotes, no labels.",
].join("\n");

function asLine(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? `${label}: ${t}` : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${label}: ${value}`;
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
    return items.length > 0 ? `${label}: ${items.join(", ")}` : null;
  }
  return null;
}

// Deterministic fallback overview (spec § 6).
function buildStub(scout: {
  event_name: string | null;
  client_name: string | null;
  city: string | null;
  live_dates: string | null;
}): string {
  const event = (scout.event_name ?? "").trim() || "Event";
  const client = (scout.client_name ?? "").trim() || "the client";
  const city = (scout.city ?? "").trim();
  const live = (scout.live_dates ?? "").trim();
  const where = city ? ` in ${city}` : "";
  const when = live ? ` Live ${live}.` : "";
  return `${event} for ${client}${where}.${when}`;
}

// --- overview_source_hash (pass 3) -------------------------------------------
// Reproduce src/lib/venue-scout/briefForm.ts computeOverviewSourceHash exactly.
// The client builds its input from a BriefFormState; the server builds the
// same canonical object from the persisted scout row (which is exactly what
// toUpdate(form) wrote, so the array/scalar values match byte-for-byte). The
// budget_text + expected_guest_count helpers below mirror briefForm.ts's
// formatBudget + asString so the named-column budget and the numeric
// brief_data.expected_guest_count canonicalize to the same display strings the
// client hashed. Arrays are coerced to string[] but NOT trimmed/de-emptied:
// the client helper hashes form arrays as-is, so the server must too. If the
// overview prompt's input set changes, update both sides in lockstep.
function hashFormatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function hashAsString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}
function hashAsStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
function hashAsNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function computeOverviewSourceHash(
  scout: {
    client_name: string | null;
    event_name: string | null;
    live_dates: string | null;
    city: string | null;
    budget: number | null;
  },
  briefData: Record<string, unknown>,
): Promise<string> {
  const normalize = (v: string) => v.trim() || null;
  // Object key order MUST match briefForm.ts -- JSON.stringify is order-sensitive.
  const source = {
    client_name: normalize(scout.client_name ?? ""),
    event_name: normalize(scout.event_name ?? ""),
    live_dates: normalize(scout.live_dates ?? ""),
    install_dates: normalize(hashAsString(briefData.install_dates)),
    strike_dates: normalize(hashAsString(briefData.strike_dates)),
    city: normalize(scout.city ?? ""),
    budget_text: normalize(hashFormatBudget(scout.budget)),
    expected_guest_count: normalize(
      hashAsString(briefData.expected_guest_count),
    ),
    activations_count: hashAsNumberOrNull(briefData.activations_count),
    objectives: hashAsStringArray(briefData.objectives).sort(),
    target_audience: normalize(hashAsString(briefData.target_audience)),
    vibe_aesthetic: normalize(hashAsString(briefData.vibe_aesthetic)),
    target_neighborhoods: hashAsStringArray(
      briefData.target_neighborhoods,
    ).sort(),
    venue_types: hashAsStringArray(briefData.venue_types).sort(),
    ideal_features: hashAsStringArray(briefData.ideal_features).sort(),
  };
  const json = JSON.stringify(source);
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { scout_id?: string };
  try {
    body = (await req.json()) as { scout_id?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select(
      "id, client_name, event_name, live_dates, city, budget, brief_data",
    )
    .eq("id", scout_id)
    .maybeSingle();

  if (scoutErr || !scout) {
    return jsonResponse(
      { error: `Could not load scout: ${scoutErr?.message ?? "not found"}` },
      404,
    );
  }

  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;

  // Build a readable context block from the named columns + the Phase 4
  // Revision brief_data keys. Skip anything the producer left blank.
  const contextLines = [
    asLine("Client", scout.client_name),
    asLine("Event", scout.event_name),
    asLine("City", scout.city),
    asLine("Live dates", scout.live_dates),
    asLine("Install dates", briefData.install_dates),
    asLine("Strike dates", briefData.strike_dates),
    typeof scout.budget === "number"
      ? `Budget: $${scout.budget.toLocaleString("en-US")}`
      : null,
    asLine("Expected guest count", briefData.expected_guest_count),
    asLine("Activations / spaces", briefData.activations_count),
    asLine("Objectives", briefData.objectives),
    asLine("Target audience", briefData.target_audience),
    asLine("Vibe / aesthetic", briefData.vibe_aesthetic),
    asLine("Target neighborhoods", briefData.target_neighborhoods),
    asLine("Venue types", briefData.venue_types),
    asLine("Ideal features", briefData.ideal_features),
  ].filter((l): l is string => l !== null);

  const stub = buildStub(scout);

  let overview = "";
  if (contextLines.length > 0) {
    const userMsg = `BRIEF FIELDS\n${contextLines.join("\n")}\n\nWrite the Event Overview paragraph.`;
    const result = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        system: SYSTEM_PROMPT,
        max_tokens: 600,
        fn_name: "vs-generate-brief-overview",
      },
    );
    if (result.ok) {
      overview = result.text.trim();
    } else {
      console.warn(
        `[vs-generate-brief-overview] scout=${scout_id} Claude call failed: ${result.error}`,
      );
    }
  }

  // Fall back to the deterministic stub on a Claude failure or empty result.
  if (!overview) {
    overview = stub;
  }

  // Compute the source hash and write it alongside the overview in a single
  // UPDATE. Merge into the existing brief_data jsonb so the other keys
  // (uploaded_files, idempotency flags, legacy notes) are preserved.
  const overviewSourceHash = await computeOverviewSourceHash(scout, briefData);
  const updatedBriefData = {
    ...briefData,
    overview_source_hash: overviewSourceHash,
  };

  const { error: updErr } = await sb
    .from("vs_scouts")
    .update({
      event_overview: overview,
      brief_data: updatedBriefData,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id);

  if (updErr) {
    return jsonResponse(
      { error: `Could not save overview: ${updErr.message}` },
      500,
    );
  }

  return jsonResponse({
    event_overview: overview,
    overview_source_hash: overviewSourceHash,
  });
});
