// vs-generate-brief-overview (Phase 4 Revision - Intake)
//
// Generates the Event Overview paragraph for a Venue Scout brief. Called from
// BriefReport (Step 3) on first arrival -- when event_overview is empty -- and
// re-invokable via the Regenerate link.
//
// Signature:
//   POST { scout_id: string } -> { event_overview: string }
//
// Flow:
//   1. Validate scout_id (UUID).
//   2. Load the scout's brief fields via the service-role client.
//   3. Build a context block from the named columns + the Phase 4 Revision
//      brief_data keys and ask Claude (via callClaude('venue_scout')) for a
//      3-5 sentence overview in Mirror's voice.
//   4. Write event_overview back to the scout, return it.
//
// Failure mode: if Claude errors or returns empty, fall back to a
// deterministic stub and persist that instead, so the producer always lands
// on a non-empty, editable overview.
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

  const { error: updErr } = await sb
    .from("vs_scouts")
    .update({
      event_overview: overview,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id);

  if (updErr) {
    return jsonResponse(
      { error: `Could not save overview: ${updErr.message}` },
      500,
    );
  }

  return jsonResponse({ event_overview: overview });
});
