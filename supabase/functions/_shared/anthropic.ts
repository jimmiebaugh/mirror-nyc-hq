// Centralized Anthropic call wrapper used by every Claude-calling Edge function
// in HQ. Per Q6 in the Talent Scout port plan:
//   - Per-app API keys: ANTHROPIC_API_KEY_TS / _VS / _HQ.
//   - Tracks spend in global_settings.anthropic_spend_current_month_usd.
//   - Emails the admin once when spend crosses the monthly cap, then sets
//     cap_alert_sent_this_month=true to suppress repeat alerts until a monthly
//     cron resets it. Does NOT refuse calls when over cap (degradation, not
//     hard failure — the spec is explicit about this).
//   - Pricing baked in for claude-sonnet-4-6: $3/MTok in, $15/MTok out, with
//     prompt-cache discounts for cache_read tokens.
//
// Phase 3.8: real email path is wired here via _shared/sendEmail.ts. The admin
// recipient is looked up from public.users where permission_role='admin'
// (oldest admin by created_at), falling back to jobs@mirrornyc.com.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAdminEmail, sendGmail } from "./sendEmail.ts";

export type AppKey = "talent_scout" | "venue_scout" | "hq";

const KEY_BY_APP: Record<AppKey, string> = {
  talent_scout: "ANTHROPIC_API_KEY_TS",
  venue_scout: "ANTHROPIC_API_KEY_VS",
  hq: "ANTHROPIC_API_KEY_HQ",
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2000;

// claude-sonnet-4-6 pricing per 1M tokens.
const PRICE_IN_PER_MTOK = 3;
const PRICE_OUT_PER_MTOK = 15;
const PRICE_CACHE_WRITE_PER_MTOK = 3.75;
const PRICE_CACHE_READ_PER_MTOK = 0.3;

// Defense-in-depth: if Anthropic ever echoes a credential prefix back in an
// error body (or one slipped into a header value upstream), scrub it before
// the error string flows into logs or the function response. Patterns cover
// Supabase publishable / secret keys, OpenAI-style sk- keys, and bearer
// tokens. Cheap to apply; safe to extend with future provider prefixes.
function redactSecrets(s: string): string {
  return s
    .replace(/sb_[a-zA-Z0-9_]+/g, "[REDACTED sb token]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED sk token]")
    .replace(/Bearer [a-zA-Z0-9_.-]+/g, "Bearer [REDACTED]");
}

// Cap Anthropic calls at 60s wall-clock. A hung upstream burns the full
// Edge Function budget (400s on Pro) and the caller has no signal to give
// up. AbortSignal.timeout fires a DOMException whose name is either
// "AbortError" or "TimeoutError" depending on runtime; we map both to a
// stable "anthropic_timeout_60s" error string.
const ANTHROPIC_TIMEOUT_MS = 60_000;

export type ClaudeImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type ClaudeContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }
  | {
      type: "image";
      source: { type: "base64"; media_type: ClaudeImageMediaType; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentPart[];
};

/**
 * Anthropic tool definition. Mirrors the API shape:
 *   - Custom tools: { name, description, input_schema }
 *   - Server tools: { type: "web_search_20250305" | ..., name, ... }
 * Phase 4.4 (vs-start-sourcing) is the first HQ caller to need tools.
 */
// deno-lint-ignore no-explicit-any
export type ClaudeTool = Record<string, any>;

export type ClaudeToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export type CallClaudeOptions = {
  model?: string;
  max_tokens?: number;
  /** System prompt. String or content-block array (the latter for cache breakpoints). */
  system?: string | ClaudeContentPart[];
  /** Beta headers, e.g. ["prompt-caching-2024-07-31", "extended-cache-ttl-2025-04-11"]. */
  anthropic_beta?: string[];
  /** Caller label for logs. */
  fn_name?: string;
  /**
   * Tools (server tools like web_search and / or custom tools) the model may
   * invoke. Pair with `tool_choice` to force a specific tool.
   */
  tools?: ClaudeTool[];
  tool_choice?: ClaudeToolChoice;
};

/** A single content block from Claude's response (text, tool_use, etc.). */
// deno-lint-ignore no-explicit-any
export type ClaudeResponseBlock = Record<string, any> & { type: string };

export type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type ClaudeOk = {
  ok: true;
  text: string;
  /**
   * Full content array from the response, in order. Includes text, tool_use,
   * server_tool_use, and any other block types the API returned. Inspect this
   * (rather than `text`) when the call uses tools.
   */
  content: ClaudeResponseBlock[];
  /** Stop reason from the API: "end_turn" | "tool_use" | "max_tokens" | etc. */
  stop_reason: string | null;
  usage: ClaudeUsage;
  cost_usd: number;
  raw: unknown;
};

export type ClaudeFail = {
  ok: false;
  status: number;
  error: string;
  raw?: unknown;
};

export type ClaudeResult = ClaudeOk | ClaudeFail;

function getApiKey(app: AppKey): string {
  const envName = KEY_BY_APP[app];
  const key = Deno.env.get(envName);
  if (!key) {
    throw new Error(`Missing Anthropic API key for app=${app} (expected env var ${envName}).`);
  }
  return key;
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function calcCost(usage: ClaudeUsage): number {
  const standardIn = Math.max(0, usage.input_tokens - (usage.cache_read_input_tokens ?? 0));
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const out = usage.output_tokens;
  return (
    (standardIn / 1_000_000) * PRICE_IN_PER_MTOK +
    (cacheRead / 1_000_000) * PRICE_CACHE_READ_PER_MTOK +
    (cacheWrite / 1_000_000) * PRICE_CACHE_WRITE_PER_MTOK +
    (out / 1_000_000) * PRICE_OUT_PER_MTOK
  );
}

// Phase 3.8: real email path. Sends from jobs@mirrornyc.com to the first
// admin in public.users. cap_alert_sent_this_month gating ensures this fires
// at most once per month; monthly-spend-reset cron re-arms it on the 1st.
async function emailAdminCapCrossed(
  spentBefore: number,
  spentAfter: number,
  cap: number,
): Promise<void> {
  try {
    const sb = getServiceClient();
    const to = await getAdminEmail(sb);
    const subject = `Anthropic spend cap crossed ($${cap.toFixed(2)})`;
    const bodyText = [
      `Heads up: HQ's monthly Anthropic spend just crossed the configured cap.`,
      ``,
      `  Spent before this call: $${spentBefore.toFixed(2)}`,
      `  Spent after this call:  $${spentAfter.toFixed(2)}`,
      `  Monthly cap:            $${cap.toFixed(2)}`,
      ``,
      `Calls continue running (graceful degradation, not a hard cutoff). This`,
      `is a single alert per cap crossing — the monthly-spend-reset cron resets`,
      `the counter and re-arms this notification on the 1st of next month.`,
      ``,
      `Adjust the cap or pause heavy operations from /talent-scout/settings.`,
    ].join("\n");
    await sendGmail({ to, subject, bodyText });
    console.log(`[anthropic-spend-tracker] cap-alert email dispatched to ${to}`);
  } catch (e) {
    console.error("[anthropic-spend-tracker] cap-alert email failed:", e);
  }
}

async function trackSpendAndAlert(costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const sb = getServiceClient();
  const { data: settings, error } = await sb
    .from("global_settings")
    .select(
      "id, anthropic_spend_cap_monthly_usd, anthropic_spend_current_month_usd, cap_alert_sent_this_month",
    )
    .limit(1)
    .maybeSingle();

  if (error || !settings) {
    console.warn("[anthropic-spend-tracker] could not load global_settings; skipping spend tracking", error);
    return;
  }

  const cap = Number(settings.anthropic_spend_cap_monthly_usd ?? 0);
  const before = Number(settings.anthropic_spend_current_month_usd ?? 0);
  const after = before + costUsd;
  const alreadyAlerted = !!settings.cap_alert_sent_this_month;
  const justCrossed = cap > 0 && before < cap && after >= cap && !alreadyAlerted;

  await sb
    .from("global_settings")
    .update({
      anthropic_spend_current_month_usd: after,
      ...(justCrossed ? { cap_alert_sent_this_month: true } : {}),
    })
    .eq("id", settings.id);

  if (justCrossed) {
    await emailAdminCapCrossed(before, after, cap);
  }
}

// Post-4.10.4 hot patch round 9: pause_turn continuation handling.
//
// Anthropic's server-tool loop (web_search, web_fetch, code_execution)
// can return stop_reason=pause_turn when a long-running turn hits an
// internal pause point. The caller is expected to send another request
// with the prior assistant content appended as a message, and Claude
// will continue the turn. Without this loop, callers that emit a
// forced custom tool after multi-step web_search research see
// "no structured output" failures because the tool_use block hasn't
// emitted yet -- Claude was still mid-research when the pause fired.
//
// Spec: https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools#the-server-side-loop-and-pause-turn
//
// Cap continuations tight: post-4.10.4 round 10 dropped this 3 -> 1
// because Phase B kept burning the 360s app-level WORK_TIMEOUT_MS
// running through multiple continuation cycles. One continuation is
// usually enough for Claude to wrap up its research and emit the
// final tool_use; if even one continuation isn't enough, the call
// fails cleanly via "no structured output" and the producer retries.
const MAX_PAUSE_CONTINUATIONS = 1;

export async function callClaude(
  app: AppKey,
  messages: ClaudeMessage[],
  options: CallClaudeOptions = {},
): Promise<ClaudeResult> {
  const apiKey = getApiKey(app);
  const model = options.model ?? DEFAULT_MODEL;
  const max_tokens = options.max_tokens ?? DEFAULT_MAX_TOKENS;

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (options.anthropic_beta?.length) {
    headers["anthropic-beta"] = options.anthropic_beta.join(",");
  }

  // Pause-turn continuation loop. `currentMessages` grows by one assistant
  // message per pause cycle; everything else (system, tools, tool_choice)
  // stays identical. Tokens + content blocks accumulate across cycles so
  // the final returned result represents the full multi-turn output.
  const currentMessages: ClaudeMessage[] = [...messages];
  const accumulatedBlocks: ClaudeResponseBlock[] = [];
  let accumulatedInputTokens = 0;
  let accumulatedOutputTokens = 0;
  let accumulatedCacheCreation = 0;
  let accumulatedCacheRead = 0;
  let accumulatedCost = 0;
  let finalStopReason: string | null = null;
  let finalData: unknown = null;
  let pauseContinuations = 0;

  while (true) {
    const body: Record<string, unknown> = {
      model,
      max_tokens,
      messages: currentMessages,
    };
    if (options.system !== undefined) body.system = options.system;
    if (options.tools !== undefined) body.tools = options.tools;
    if (options.tool_choice !== undefined) body.tool_choice = options.tool_choice;

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        return { ok: false, status: 0, error: "anthropic_timeout_60s" };
      }
      return {
        ok: false,
        status: 0,
        error: `Anthropic fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `[callClaude] app=${app} fn=${options.fn_name ?? "?"} status=${res.status} err=${redactSecrets(errText.slice(0, 300))}`,
      );
      return { ok: false, status: res.status, error: redactSecrets(errText.slice(0, 500)) };
    }

    const data = await res.json();
    finalData = data;
    const blocks: ClaudeResponseBlock[] = Array.isArray(data?.content)
      ? data.content
      : [];
    accumulatedBlocks.push(...blocks);
    accumulatedInputTokens += data?.usage?.input_tokens ?? 0;
    accumulatedOutputTokens += data?.usage?.output_tokens ?? 0;
    accumulatedCacheCreation += data?.usage?.cache_creation_input_tokens ?? 0;
    accumulatedCacheRead += data?.usage?.cache_read_input_tokens ?? 0;
    accumulatedCost += calcCost({
      input_tokens: data?.usage?.input_tokens ?? 0,
      output_tokens: data?.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: data?.usage?.cache_creation_input_tokens,
      cache_read_input_tokens: data?.usage?.cache_read_input_tokens,
    });

    finalStopReason =
      typeof data?.stop_reason === "string" ? data.stop_reason : null;

    // Continue the turn if Anthropic paused it. Append the assistant's
    // content blocks as the next message (per the server-tools docs
    // example) and re-call. Stop after MAX_PAUSE_CONTINUATIONS to avoid
    // pathological loops.
    if (
      finalStopReason === "pause_turn" &&
      pauseContinuations < MAX_PAUSE_CONTINUATIONS
    ) {
      pauseContinuations += 1;
      // The Anthropic API accepts an assistant message whose content is
      // the raw response blocks (server_tool_use, tool_use, text, etc.).
      // Our ClaudeContentPart union is narrower than what the API
      // accepts for echoed assistant turns, so cast through unknown.
      currentMessages.push({
        role: "assistant",
        content: blocks as unknown as ClaudeMessage["content"],
      });
      console.log(
        `[callClaude] app=${app} fn=${options.fn_name ?? "?"} pause_turn continuation ${pauseContinuations}/${MAX_PAUSE_CONTINUATIONS}`,
      );
      continue;
    }

    break;
  }

  // Concatenate every text block in order. Pre-tools callers expected
  // `text` to be a flat string of the model's reply; preserve that.
  // Tool callers should read `content` directly. With pause_turn
  // continuations, text comes from every cycle's blocks merged in order.
  const text: string = accumulatedBlocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const usage: ClaudeUsage = {
    input_tokens: accumulatedInputTokens,
    output_tokens: accumulatedOutputTokens,
    cache_creation_input_tokens:
      accumulatedCacheCreation > 0 ? accumulatedCacheCreation : undefined,
    cache_read_input_tokens:
      accumulatedCacheRead > 0 ? accumulatedCacheRead : undefined,
  };

  console.log(
    `[callClaude] app=${app} fn=${options.fn_name ?? "?"} in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_w=${usage.cache_creation_input_tokens ?? 0} cache_r=${usage.cache_read_input_tokens ?? 0} ` +
      `cost=$${accumulatedCost.toFixed(4)}` +
      (pauseContinuations > 0
        ? ` pause_continuations=${pauseContinuations}`
        : ""),
  );

  // Don't await spend tracking on the response path — fire-and-forget would lose
  // updates on edge function shutdown. Await but swallow errors so a logging
  // outage never blocks the caller.
  try {
    await trackSpendAndAlert(accumulatedCost);
  } catch (e) {
    console.warn("[anthropic-spend-tracker] tracking failed (non-fatal):", e);
  }

  return {
    ok: true,
    text,
    content: accumulatedBlocks,
    stop_reason: finalStopReason,
    usage,
    cost_usd: accumulatedCost,
    raw: finalData,
  };
}

/**
 * Web search result extracted from a Claude response. Each entry is one
 * page surfaced by the web_search server tool. The url + title come
 * directly from the search engine; encrypted_content is what Anthropic
 * needs for citation continuity in multi-turn conversations.
 *
 * Per the Anthropic web_search docs, each `web_search_tool_result`
 * content block has a nested `content` array of `web_search_result`
 * objects with this shape.
 */
export type WebSearchResult = {
  url: string;
  title: string;
};

/**
 * Walk a Claude response's content blocks and pull every web_search_result
 * surfaced by the model. Returns them in order of appearance (which
 * roughly corresponds to relevance per query). Used by venue-research
 * callers as a fallback when Claude's tool output left website_url null
 * but search results clearly contained valid URLs.
 *
 * Post-4.10.4 hot patch round 13: introduced after smoke 2026-05-13
 * showed Phase B research consistently leaving website_url null even
 * for known-branded venues, because FILL_SYSTEM tells Claude not to
 * use listing-database URLs and Claude was being conservative. The
 * URLs ARE in the search results blocks; we just weren't reading them.
 */
export function extractWebSearchResults(
  content: ClaudeResponseBlock[],
): WebSearchResult[] {
  const out: WebSearchResult[] = [];
  for (const block of content) {
    if (block?.type !== "web_search_tool_result") continue;
    const inner = (block as { content?: unknown }).content;
    if (!Array.isArray(inner)) continue;
    for (const r of inner) {
      if (
        r &&
        typeof r === "object" &&
        (r as { type?: string }).type === "web_search_result" &&
        typeof (r as { url?: unknown }).url === "string"
      ) {
        const u = (r as { url: string }).url;
        const t = typeof (r as { title?: unknown }).title === "string"
          ? ((r as { title: string }).title)
          : "";
        out.push({ url: u, title: t });
      }
    }
  }
  return out;
}

/**
 * Targeted per-venue web-search for the venue's own dedicated website.
 *
 * Post-4.10.4 hot patch round 14: round-13's findBestSearchResultUrl
 * fallback used the BROAD search results from Phase B's batch
 * submit_research call and matched titles to venue names. The matching
 * was too loose -- titles often described nearby venues or generic
 * commercial-real-estate listings, so the URLs landed wrong. This
 * helper instead runs a NEW, focused Claude call: web_search with a
 * tight "find the official site for {name} at {address}" prompt.
 *
 * Used as Phase B's URL fallback after the initial validateWebsiteUrls
 * pass returns null.
 *
 * Returns the first non-listing-database URL the model surfaces (via
 * sanitizeWebsiteUrl), or null. Caller should HEAD-validate the result
 * before persisting.
 *
 * Cost: one Claude call per venue, ~10-15s typical. Run in parallel
 * across all null-URL venues; aggregate latency stays bounded.
 */
export async function findVenueWebsite(
  app: AppKey,
  args: { name: string; address: string | null; city: string | null },
  options: { fn_name?: string } = {},
): Promise<string | null> {
  const addr = args.address?.trim();
  const city = args.city?.trim();
  const where = [addr, city].filter(Boolean).join(", ") || "(unknown location)";
  const prompt =
    `Find the official, dedicated website URL for this venue:\n\n` +
    `Name: ${args.name}\n` +
    `Location: ${where}\n\n` +
    `Use web_search. Return ONLY the venue's own dedicated website URL (or a deep-link listing URL like peerspace.com/spaces/<id>, thestorefront.com/listing/<slug>, loopnet.com/Listing/<full-id> if the venue has no dedicated site). Do NOT return search-result pages, directory homepages, or guesses. If you cannot find a confident match, respond with the literal text "NONE".\n\n` +
    `Respond with the bare URL on a single line, with no commentary.`;
  const result = await callClaude(
    app,
    [{ role: "user", content: prompt }],
    {
      max_tokens: 500,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 2 },
      ],
      tool_choice: { type: "auto" },
      fn_name: options.fn_name ?? "findVenueWebsite",
    },
  );
  if (!result.ok) return null;
  // Pull the first http(s) URL out of any text block.
  const urlRe = /https?:\/\/[^\s<>"]+/i;
  for (const b of result.content ?? []) {
    if (b?.type === "text" && typeof b.text === "string") {
      const m = b.text.match(urlRe);
      if (m) {
        // Strip trailing sentence-end punctuation Claude sometimes
        // appends. Excludes ')' because listing URLs (Peerspace,
        // LoopNet, TheVendry, etc.) occasionally have parens in the
        // path (e.g. .../listing/foo(bar)). Stripping ')' truncated
        // those.
        return m[0].replace(/[.,;:!?]+$/, "");
      }
    }
  }
  // Fallback: pull first URL from the search results themselves.
  const searchResults = extractWebSearchResults(result.content ?? []);
  if (searchResults.length > 0) return searchResults[0].url;
  return null;
}
