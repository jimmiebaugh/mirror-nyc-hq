// Shared builder for Claude per-candidate eval requests.
// Uses two prompt-caching breakpoints (system + role context), both with
// explicit 1-hour TTL since pulls can run for many minutes.
//
// Per-pull invariant: buildRoleContext() must produce byte-identical output
// for every candidate in the same pull so the role-context cache hits.

import { DEFAULT_EVAL_PROMPT, LOCATION_RULES } from "./prompts.ts";

export const CLAUDE_EVAL_MODEL = "claude-sonnet-4-6";
export const CLAUDE_EVAL_MAX_TOKENS = 1600;

export function getClaudeSystemText(systemPromptOverride?: string): string {
  if (!systemPromptOverride || !systemPromptOverride.trim().length) {
    return DEFAULT_EVAL_PROMPT;
  }
  // Custom prompt: append location rules if not already present. Prevents
  // double-injection when a custom prompt was copied from the default and
  // already contains the section.
  if (systemPromptOverride.includes("Location Considerations")) {
    return systemPromptOverride;
  }
  return systemPromptOverride + "\n\n" + LOCATION_RULES;
}

export function buildRoleContext(
  role: any,
  scorecard: any,
  competitors: string[],
): string {
  const competitorList = (competitors ?? []).join(", ");
  return [
    `## Role Context`,
    `Role: ${role.title ?? ""}`,
    `Job Description: ${role.jd_full_text ?? ""}`,
    `Hiring Priorities (not in JD): ${role.hiring_priorities ?? "(none)"}`,
    `Auto-Rejection Threshold: ${role.auto_rejection_threshold ?? 60}/100`,
    ``,
    `## Scorecard (locked)`,
    JSON.stringify(scorecard.criteria ?? []),
    ``,
    `## Competitor List`,
    competitorList || "(none)",
  ].join("\n");
}

export function buildCandidateBundleText(
  candidateBundle: string,
  detectedUrls: string[],
): string {
  const urlsBlock = detectedUrls.length ? detectedUrls.join("\n") : "None detected";
  return [
    `## Candidate Materials`,
    candidateBundle,
    ``,
    `## URLs Detected in Candidate Materials (LinkedIn filtered out)`,
    urlsBlock,
  ].join("\n");
}

export function buildClaudeEvalRequest(args: {
  role: any;
  scorecard: any;
  competitors: string[];
  candidateBundle: string;
  detectedUrls: string[];
  systemPromptOverride?: string;
}) {
  const systemText = getClaudeSystemText(args.systemPromptOverride);
  const roleContext = buildRoleContext(args.role, args.scorecard, args.competitors);
  const candidateText = buildCandidateBundleText(args.candidateBundle, args.detectedUrls);

  return {
    model: CLAUDE_EVAL_MODEL,
    max_tokens: CLAUDE_EVAL_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: roleContext,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          {
            type: "text",
            text: candidateText,
          },
        ],
      },
    ],
  };
}

export function getClaudeStaticPrefixLength(args: {
  role: any;
  scorecard: any;
  competitors: string[];
  systemPromptOverride?: string;
}): number {
  return getClaudeSystemText(args.systemPromptOverride).length
    + buildRoleContext(args.role, args.scorecard, args.competitors).length;
}

// Classify a URL into the {url, type} shape used by the UI/packets.
// Replaces what Claude used to emit in detected_portfolio_urls.
export function classifyDetectedUrls(urls: string[]): Array<{ url: string; type: string }> {
  return (urls ?? []).map((url) => {
    const lower = url.toLowerCase();
    let type = "other";
    if (lower.includes("vimeo.com")) type = "vimeo_reel";
    else if (lower.includes("drive.google.com") || lower.includes("dropbox.com") || lower.includes("wetransfer.com")) type = "drive_folder";
    else if (
      lower.includes("behance.net") || lower.includes("dribbble.com") ||
      lower.includes("cargo.site") || lower.includes("squarespace.com") ||
      lower.includes("wixsite.com") || lower.includes("notion.site") ||
      lower.includes("are.na") || lower.includes("readymag.com") ||
      lower.includes("portfolio") || lower.includes("myportfolio.com") ||
      lower.includes("framer.website") || lower.includes("webflow.io")
    ) type = "portfolio_site";
    return { url, type };
  });
}

export function logClaudeUsage(label: string, usage: any, candidateRef: string) {
  console.log(
    `[claude-eval] tokens: input=${usage?.input_tokens ?? 0} output=${usage?.output_tokens ?? 0} cache_create=${usage?.cache_creation_input_tokens ?? 0} cache_read=${usage?.cache_read_input_tokens ?? 0} candidate=${candidateRef} ${label}`,
  );
}
