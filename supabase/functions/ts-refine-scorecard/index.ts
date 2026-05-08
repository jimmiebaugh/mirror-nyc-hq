// ts-refine-scorecard
//
// Phase 3.10. Called from the new-role wizard's step-3 page after the user
// has edited or added criteria. Refines the user-provided phrasing so every
// criterion lands in the standard short-name + concrete-describer shape the
// downstream evaluation prompt expects, without removing or overriding any
// concept the user provided.
//
// Body: { role_title, jd, hiring_priorities?, location?, employment_type?,
//         comp?, criteria: Criterion[] }
// Returns: { criteria: Criterion[], cost_usd, tokens }
//
// Auth: default verify_jwt = true. Frontend supabase.functions.invoke
// includes the user JWT, which is the wizard admin who's drafting the role.
//
// Hard rules enforced server-side:
//   - Pre-Claude filter: criteria with weight=0 OR with both `name` and
//     `full_points_rubric` empty/whitespace-only are dropped from the
//     refine pass entirely. They're considered dead — either the user
//     zeroed them out (signaling "remove me") or never filled them in.
//     The dropped count is reported back so the UI can surface it.
//   - Per-index tier / weight / is_disqualifier / is_manual values are
//     restored from the (filtered) input regardless of what the model
//     returned. The model is only trusted for `name` and
//     `full_points_rubric`.
//   - partial_points_rubric is forced to "" (reserved field).
//   - Output count = filtered input count. Bad model output can't change
//     the scorecard length.

import { parseClaudeJson, JSON_ONLY_INSTRUCTION } from "../_shared/parseClaudeJson.ts";
import { callClaude } from "../_shared/anthropic.ts";
import { scorecardRefinementPrompt } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

type Criterion = {
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  is_disqualifier: boolean;
  full_points_rubric: string;
  /** Phase 3.11: short condensed version for compact UI surfaces. */
  summary?: string;
  partial_points_rubric: string;
  is_manual?: boolean;
};

type RefineRequest = {
  role_title?: string;
  jd?: string;
  hiring_priorities?: string;
  location?: string;
  employment_type?: string;
  comp?: string;
  criteria?: Criterion[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RefineRequest;
    const {
      role_title,
      jd,
      hiring_priorities,
      location,
      employment_type,
      comp,
      criteria,
    } = body;

    if (!role_title?.trim() || !jd?.trim()) {
      return new Response(
        JSON.stringify({ error: "role_title and jd are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!Array.isArray(criteria) || criteria.length === 0) {
      return new Response(
        JSON.stringify({ error: "criteria array is required and must be non-empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pre-Claude filter: drop dead criteria (weight=0 OR name+describer both
    // empty) before the refine pass so we don't burn tokens on them and the
    // returned scorecard is already cleaned. Track the removed count so the
    // UI can surface it.
    const liveCriteria = criteria.filter((c) => !isDeadCriterion(c));
    const removed_count = criteria.length - liveCriteria.length;
    if (liveCriteria.length === 0) {
      return new Response(
        JSON.stringify({ error: "every criterion was empty or zero-weight; nothing to refine" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const prompt = scorecardRefinementPrompt({
      role_title,
      jd,
      hiring_priorities,
      location: location ?? "",
      employment_type: employment_type ?? "",
      comp,
      current_scorecard_json: JSON.stringify(liveCriteria, null, 2),
      jsonOnlyInstruction: JSON_ONLY_INSTRUCTION,
    });

    const result = await callClaude(
      "talent_scout",
      [{ role: "user", content: prompt }],
      { max_tokens: 4000, fn_name: "ts-refine-scorecard" },
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

    const refined = mergeRefinedIntoOriginal(liveCriteria, parsed.criteria ?? []);

    return new Response(
      JSON.stringify({
        criteria: refined,
        removed_count,
        cost_usd: result.cost_usd,
        tokens: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("ts-refine-scorecard error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---------------------------------------------------------------------------
// Dead-criterion filter: drops entries that are zero-weight or have both
// name + describer empty/whitespace-only. Either signal means the user is
// telling us this entry shouldn't ship. Applied pre-Claude so we don't burn
// tokens refining empty rows.
// ---------------------------------------------------------------------------
function isDeadCriterion(c: Criterion): boolean {
  const weight = Number(c.weight) || 0;
  if (weight === 0) return true;
  const name = (c.name ?? "").trim();
  const describer = (c.full_points_rubric ?? "").trim();
  return name.length === 0 && describer.length === 0;
}

// ---------------------------------------------------------------------------
// Defense-in-depth merge: take ONLY name / full_points_rubric / summary from
// the model output (per index), and ALWAYS preserve tier / weight /
// is_disqualifier / is_manual from the user's (filtered) input. If the model
// returns fewer entries than the input, we keep the input version for the
// missing tail. If the model returns more entries, we drop the extras. This
// guarantees the user's scoring decisions can't be silently overwritten by a
// bad model response.
// ---------------------------------------------------------------------------
function mergeRefinedIntoOriginal(
  original: Criterion[],
  modelOut: unknown[],
): Criterion[] {
  const result: Criterion[] = [];
  for (let i = 0; i < original.length; i++) {
    const orig = original[i];
    // deno-lint-ignore no-explicit-any
    const r = modelOut[i] as any;
    const refinedName =
      typeof r?.name === "string" && r.name.trim().length > 0 ? r.name.trim() : orig.name;
    const refinedDescriber =
      typeof r?.full_points_rubric === "string" && r.full_points_rubric.trim().length > 0
        ? r.full_points_rubric.trim()
        : orig.full_points_rubric;
    const refinedSummary =
      typeof r?.summary === "string" && r.summary.trim().length > 0
        ? r.summary.trim()
        : (orig.summary && orig.summary.trim().length > 0 ? orig.summary : undefined);
    result.push({
      name: refinedName,
      tier: orig.tier,
      weight: orig.weight,
      is_disqualifier: orig.is_disqualifier,
      full_points_rubric: refinedDescriber,
      summary: refinedSummary,
      partial_points_rubric: "",
      is_manual: orig.is_manual,
    });
  }
  return result;
}
