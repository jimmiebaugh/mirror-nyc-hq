// ts-pull-candidates
//
// Stub. Real implementation lands in Phase 3.4: Gmail search via service-account
// JWT impersonating jobs@mirrornyc.com, attachment download, PDF text extract,
// link parsing, portfolio detection, Claude scoring with two prompt-caching
// breakpoints, chunked self-invocation across BATCH_SIZE=8 candidates.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ error: "ts-pull-candidates not implemented yet (Phase 3.4)" }),
    {
      status: 501,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
