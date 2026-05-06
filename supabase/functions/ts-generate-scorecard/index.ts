// ts-generate-scorecard
//
// Stub. Real implementation lands in Phase 3.3: takes role title +
// job_description + hiring_priorities, calls Claude to draft a tiered scorecard
// (criterion, tier 1/2/3, weight, full/partial rubrics), returns the criteria
// array which the wizard's step-3 page lets the user edit before save.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ error: "ts-generate-scorecard not implemented yet (Phase 3.3)" }),
    {
      status: 501,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
