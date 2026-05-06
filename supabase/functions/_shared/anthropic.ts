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
// The email path is currently a console-log stub; Phase 3.8 wires the real
// notifications-dispatch function and Phase 5 may move it again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

export type ClaudeContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } };

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentPart[];
};

export type CallClaudeOptions = {
  model?: string;
  max_tokens?: number;
  /** System prompt. String or content-block array (the latter for cache breakpoints). */
  system?: string | ClaudeContentPart[];
  /** Beta headers, e.g. ["prompt-caching-2024-07-31", "extended-cache-ttl-2025-04-11"]. */
  anthropic_beta?: string[];
  /** Caller label for logs. */
  fn_name?: string;
};

export type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type ClaudeOk = {
  ok: true;
  text: string;
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

// Stub email path. Replace with notifications-dispatch in Phase 3.8.
async function emailAdminCapCrossed(
  spentBefore: number,
  spentAfter: number,
  cap: number,
): Promise<void> {
  console.log(
    `[anthropic-spend-tracker] CAP CROSSED: $${spentBefore.toFixed(2)} -> $${spentAfter.toFixed(2)} (cap $${cap.toFixed(2)}). ` +
      `STUB: would email admin. Real notification path lands in Phase 3.8.`,
  );
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

  const body: Record<string, unknown> = { model, max_tokens, messages };
  if (options.system !== undefined) body.system = options.system;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `Anthropic fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[callClaude] app=${app} fn=${options.fn_name ?? "?"} status=${res.status} err=${errText.slice(0, 300)}`);
    return { ok: false, status: res.status, error: errText.slice(0, 500) };
  }

  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const usage: ClaudeUsage = {
    input_tokens: data?.usage?.input_tokens ?? 0,
    output_tokens: data?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: data?.usage?.cache_creation_input_tokens,
    cache_read_input_tokens: data?.usage?.cache_read_input_tokens,
  };
  const cost_usd = calcCost(usage);

  console.log(
    `[callClaude] app=${app} fn=${options.fn_name ?? "?"} in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_w=${usage.cache_creation_input_tokens ?? 0} cache_r=${usage.cache_read_input_tokens ?? 0} cost=$${cost_usd.toFixed(4)}`,
  );

  // Don't await spend tracking on the response path — fire-and-forget would lose
  // updates on edge function shutdown. Await but swallow errors so a logging
  // outage never blocks the caller.
  try {
    await trackSpendAndAlert(cost_usd);
  } catch (e) {
    console.warn("[anthropic-spend-tracker] tracking failed (non-fatal):", e);
  }

  return { ok: true, text, usage, cost_usd, raw: data };
}
