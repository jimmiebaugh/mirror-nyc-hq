// vs-parse-brief (Phase 4.3-port rebuild)
//
// Replaces the failed-attempt vs-parse-brief in the deployed-function slot.
// Different signature, different shape, different storage target -- but
// occupies the same name so cutover doesn't need a separate delete step.
//
// Signature:
//   POST { scout_id: string, storage_path: string } → { parsed_fields }
//
// Flow:
//   1. Validate inputs. scout_id must be UUID. storage_path must live under
//      `${scout_id}/` inside the `briefs` bucket.
//   2. Download the PDF via the service-role client (function context has
//      SUPABASE_SERVICE_ROLE_KEY).
//   3. Send to Claude as a `document` content block (no separate text
//      extraction step -- claude-sonnet-4-6 reads PDFs natively, which is the
//      modern HQ pattern and avoids the unpdf round-trip ts-pull-candidates
//      uses for email attachments).
//   4. tool_choice forces a `submit_brief` tool call. Parse the tool_use
//      block, sanitize, return as `parsed_fields`.
//
// Auth posture: verify_jwt = true (default). User-invoked synchronous; no
// self-invoke, no internal-secret path. Spend tracking flows through
// callClaude('venue_scout').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, type ClaudeTool } from "../_shared/anthropic.ts";

// User-invoked synchronous only; no internal-secret path. Don't advertise
// `x-internal-secret` to the browser preflight (caught by code-reviewer
// during 4.4-port; same cleanup applied to vs-parse-sheet in this commit).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ParseRequest = {
  scout_id?: string;
  storage_path?: string;
};

type ParsedBriefFields = {
  client_name?: string;
  event_name?: string;
  live_dates?: string;
  city?: string;
  budget?: number | null;
  event_overview?: string;
  expected_guest_count?: number | null;
  additional_notes?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Tool schema. All fields optional -- model returns what it finds, producer
// fills the rest. Numeric fields use `["number", "null"]` so the model can
// explicitly signal "not in the brief" without omitting the key entirely.
const tools: ClaudeTool[] = [
  {
    name: "submit_brief",
    description:
      "Submit the parsed brief fields extracted from the provided PDF text.",
    input_schema: {
      type: "object",
      properties: {
        client_name: {
          type: "string",
          description:
            "The client / brand name (e.g. 'Hennessy', 'Lululemon'). Omit if the brief doesn't clearly name a client.",
        },
        event_name: {
          type: "string",
          description: "The activation / event title.",
        },
        live_dates: {
          type: "string",
          description:
            "Free-text date range as it appears in the brief. Examples: 'October 15-17, 2026', 'TBD Q4 2026'. Don't normalize to ISO.",
        },
        city: {
          type: "string",
          description: "Primary city / location (e.g. 'New York, NY').",
        },
        budget: {
          type: ["number", "null"],
          description:
            "Total event budget in USD as a number. Strip currency symbols and commas. Use null if not specified.",
        },
        event_overview: {
          type: "string",
          description:
            "A 1-3 sentence summary of the activation, the audience, and the vibe.",
        },
        expected_guest_count: {
          type: ["number", "null"],
          description:
            "Expected guest / attendee count as a whole number. Use null if not specified.",
        },
        additional_notes: {
          type: "string",
          description:
            "Any other context worth carrying into venue research: brand tone, must-have features, hard nos, references. Free text. Omit if no extra context worth capturing.",
        },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = [
  "You're a brief parser for Mirror NYC, an experiential agency that produces brand activations.",
  "Read the attached brief PDF and extract structured fields that will pre-fill the producer's sourcing brief in the HQ app.",
  "",
  "Rules:",
  "- Pull only what's explicitly stated in the brief. Don't guess.",
  "- Pull dates verbatim as the brief expresses them. Don't normalize to ISO.",
  "- Pull budget as a number with currency symbols and commas stripped. Use null when not specified.",
  "- Event overview should be a 1-3 sentence summary in your own words, capturing what the activation is, who it's for, and the vibe.",
  "- additional_notes is for tone / references / must-haves / hard-nos that don't fit the structured fields. Skip the field when nothing extra is worth capturing.",
  "",
  "Return ONLY a tool call to submit_brief. Do not return text.",
].join("\n");

function sanitizeString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function sanitizeNumber(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const stripped = raw.replace(/[$,\s]/g, "");
    if (!stripped) return undefined;
    const n = parseFloat(stripped);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sanitizeInteger(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === "string") {
    const stripped = raw.replace(/[,\s]/g, "");
    if (!stripped) return undefined;
    const n = parseInt(stripped, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sanitizeParsed(raw: Record<string, unknown>): ParsedBriefFields {
  const out: ParsedBriefFields = {};

  const stringKeys: (keyof ParsedBriefFields)[] = [
    "client_name",
    "event_name",
    "live_dates",
    "city",
    "event_overview",
    "additional_notes",
  ];
  for (const k of stringKeys) {
    const v = sanitizeString(raw[k]);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }

  const budget = sanitizeNumber(raw.budget);
  if (budget !== undefined) out.budget = budget;

  const egc = sanitizeInteger(raw.expected_guest_count);
  if (egc !== undefined) out.expected_guest_count = egc;

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: ParseRequest;
  try {
    body = (await req.json()) as ParseRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  const storage_path = (body.storage_path ?? "").trim();

  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }
  if (!storage_path.startsWith(`${scout_id}/`) || !storage_path.toLowerCase().endsWith(".pdf")) {
    return jsonResponse(
      { error: "storage_path must live under '<scout_id>/' and end with .pdf" },
      400,
    );
  }
  // Defense-in-depth: Supabase Storage (S3-backed) treats `..` as literal
  // characters today, but reject anyway to stay safe under any future
  // storage backend that might interpret directory traversal.
  if (storage_path.includes("..")) {
    return jsonResponse({ error: "storage_path may not contain '..'" }, 400);
  }

  // Service-role client for storage read. Authenticated user JWT is verified
  // by the gateway (verify_jwt = true default); we don't need the user
  // identity downstream.
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: blob, error: dlErr } = await sb.storage.from("briefs").download(storage_path);
  if (dlErr || !blob) {
    return jsonResponse(
      { error: `Could not read PDF: ${dlErr?.message ?? "not found"}` },
      500,
    );
  }

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 200) {
    return jsonResponse({ error: "PDF appears empty or unreadable" }, 400);
  }
  const base64 = bytesToBase64(bytes);

  const result = await callClaude(
    "venue_scout",
    [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          {
            type: "text",
            text: "Parse the attached brief and call submit_brief with the extracted fields.",
          },
        ],
      },
    ],
    {
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: "tool", name: "submit_brief" },
      max_tokens: 1500,
      fn_name: "vs-parse-brief",
    },
  );

  if (!result.ok) {
    return jsonResponse(
      { error: `Claude call failed: ${result.error}`, parsed_fields: {} },
      result.status >= 400 && result.status < 600 ? result.status : 500,
    );
  }

  const toolUse = result.content.find((b) => b?.type === "tool_use" && b?.name === "submit_brief");
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    // No tool call returned. Return 200 with empty parsed_fields so the
    // producer can fall back to filling the form manually rather than
    // surface this as an error.
    console.warn(
      `[vs-parse-brief] no submit_brief tool_use in response (stop_reason=${result.stop_reason}, scout_id=${scout_id})`,
    );
    return jsonResponse({ parsed_fields: {} });
  }

  const parsed_fields = sanitizeParsed(toolUse.input as Record<string, unknown>);
  return jsonResponse({ parsed_fields });
});
