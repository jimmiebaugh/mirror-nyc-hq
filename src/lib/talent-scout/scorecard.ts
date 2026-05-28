// Phase 3.7.6: shared scorecard tier metadata + bonus constant.
// Used by NewRoleScorecard, RoleSettings scorecard editor, and
// CandidateDetail score breakdown. Phase 5.13.2d: `color` renamed to
// `token` and switched to canonical .p-{token} classes; labels aligned
// to colon format across all consumers.
export const TIER_META = {
  1: {
    label: "Tier 1: Must-Haves",
    subtitle: "Disqualifying if absent",
    token: "p-destructive",
  },
  2: {
    label: "Tier 2: Strong Differentiators",
    subtitle: "Meaningfully elevates a candidate",
    token: "p-warn",
  },
  3: {
    label: "Tier 3: Nice-to-Haves",
    subtitle: "Bonus value · not required",
    token: "p-success",
  },
} as const;

// Phase 3.7.6.7: max competitor bonus points dropped 12 → 10 to align with
// the updated tiered rules in DEFAULT_EVAL_PROMPT (3 / 5 / 8 + 2 leadership
// = 10 max). New total possible = 100 base + 10 bonus = 110.
export const COMPETITOR_BONUS_POINTS = 10;
