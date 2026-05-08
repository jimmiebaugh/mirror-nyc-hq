// Phase 3.7.6: shared scorecard tier metadata + bonus constant.
// Used by NewRoleScorecard (wizard step 3) and RoleSettings's scorecard
// editor card. Keeps tier labels / colors in lockstep across both
// surfaces.
//
// Tier colors aligned with source's tier-badge--{1,2,3} (Phase 3.5b):
// T1 red-500, T2 amber-500, T3 green-400 (= source's #4ade80).
export const TIER_META = {
  1: {
    label: "Tier 1 — Must-Haves",
    subtitle: "Disqualifying if absent",
    color: "bg-red-500/10 border-red-500/30 text-red-500",
  },
  2: {
    label: "Tier 2 — Strong Differentiators",
    subtitle: "Meaningfully elevates a candidate",
    color: "bg-amber-500/10 border-amber-500/30 text-amber-500",
  },
  3: {
    label: "Tier 3 — Nice-to-Haves",
    subtitle: "Bonus value · not required",
    color: "bg-green-400/10 border-green-400/30 text-green-400",
  },
} as const;

// Phase 3.7.6.7: max competitor bonus points dropped 12 → 10 to align with
// the updated tiered rules in DEFAULT_EVAL_PROMPT (3 / 5 / 8 + 2 leadership
// = 10 max). New total possible = 100 base + 10 bonus = 110.
export const COMPETITOR_BONUS_POINTS = 10;
