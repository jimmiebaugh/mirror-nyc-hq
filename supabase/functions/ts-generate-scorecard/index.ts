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

    return new Response(
      JSON.stringify({
        criteria: parsed.criteria ?? [],
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
