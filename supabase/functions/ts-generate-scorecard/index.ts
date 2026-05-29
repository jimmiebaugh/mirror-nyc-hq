// ts-generate-scorecard
//
// Drafts a weighted, tiered scorecard from a role's title + JD + hiring
// priorities. Called from the new-role wizard's step-3 page; the user can
// edit the returned criteria before saving the role.
//
// Body: { role_title, jd, hiring_priorities?, location?, employment_type?, comp? }
// Returns: { criteria: Criterion[], cost_usd, tokens: { input_tokens, output_tokens } }
//
// Auth: relies on the function's verify_jwt setting (default true). The Data
// API call inside callClaude uses the service role, but the user's JWT must
// be present on the request.

import { parseClaudeJson, JSON_ONLY_INSTRUCTION } from "../_shared/parseClaudeJson.ts";
import { callClaude } from "../_shared/anthropic.ts";
import { scorecardGenerationPrompt } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

type ScorecardRequest = {
  role_title?: string;
  jd?: string;
  hiring_priorities?: string;
  location?: string;
  employment_type?: string;
  comp?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ScorecardRequest;
    const { role_title, jd, hiring_priorities, location, employment_type, comp } = body;

    if (!role_title?.trim() || !jd?.trim()) {
      return new Response(
        JSON.stringify({ error: "role_title and jd are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const prompt = scorecardGenerationPrompt({
      role_title,
      jd,
      hiring_priorities,
      location,
      employment_type,
      comp,
      jsonOnlyInstruction: JSON_ONLY_INSTRUCTION,
    });

    const result = await callClaude(
      "talent_scout",
      [{ role: "user", content: prompt }],
      { max_tokens: 2000, fn_name: "ts-generate-scorecard" },
    );

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: `Anthropic API error (${result.status}): ${result.error}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: { criteria?: unknown[] };
    try {
      parsed = parseClaudeJson(result.text);
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: "Claude returned invalid JSON", raw: result.text.slice(0, 200) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Phase 3.7.4: post-Claude normalizer. The prompt asks Claude to make
    // weights sum to 100, but it occasionally drifts (especially with a lot
    // of criteria). Normalize defensively here so the wizard always loads a
    // 100-point scorecard, regardless of what the model returned. If
    // sum=100 already this is a no-op.
    const criteria = normalizeWeightsTo100(parsed.criteria ?? []);

    return new Response(
      JSON.stringify({
        criteria,
        cost_usd: result.cost_usd,
        tokens: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ts-generate-scorecard error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---------------------------------------------------------------------------
// Phase 3.7.4: scale criteria weights so the sum is exactly 100 integer points.
//
// 1. Coerce each weight to a non-negative integer (drop NaN/null to 0).
// 2. If the total is already 100, no-op.
// 3. Otherwise multiply each weight by (100 / total) and round.
// 4. Rounding deltas land on the largest-weight criterion so we don't disturb
//    smaller Tier 3 criteria proportionally more than they're worth.
// 5. Edge case: if every weight came in as 0 (or list empty), return as-is —
//    the wizard's UI shows zeros and the user fills them in by hand.
// ---------------------------------------------------------------------------
function normalizeWeightsTo100(rawCriteria: unknown[]): unknown[] {
  const criteria = (rawCriteria as Record<string, unknown>[]).map((c) => ({
    ...c,
    weight: Math.max(0, Math.round(Number(c?.weight) || 0)),
  }));
  const sum = criteria.reduce((s, c) => s + c.weight, 0);
  if (sum === 100 || sum === 0) {
    if (sum !== 100) {
      console.warn(`[ts-generate-scorecard] criteria weights summed to ${sum}; returning as-is for manual fill.`);
    }
    return criteria;
  }
  console.log(`[ts-generate-scorecard] normalizing weights from ${sum} → 100`);
  // Scale + round.
  const scaled = criteria.map((c) => ({
    ...c,
    weight: Math.round((c.weight * 100) / sum),
  }));
  // Absorb the rounding delta on the largest-weight criterion.
  const newSum = scaled.reduce((s, c) => s + c.weight, 0);
  const delta = 100 - newSum;
  if (delta !== 0 && scaled.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i].weight > scaled[maxIdx].weight) maxIdx = i;
    }
    scaled[maxIdx].weight = Math.max(0, scaled[maxIdx].weight + delta);
  }
  return scaled;
}
