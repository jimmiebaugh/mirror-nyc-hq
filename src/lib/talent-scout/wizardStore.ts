// In-memory store for the New Role wizard. Resets on full reload.
// Field names match the HQ ts_roles schema directly so step-3 INSERT is a
// straight pass-through. Hiring manager is stored as a uuid (FK to users)
// because Phase 3.3 uses a picker over admin users — see Q3 in CLAUDE.md.

import type { Database } from "@/integrations/supabase/types";

type AutoPullSchedule = Database["public"]["Enums"]["ts_role_auto_pull_schedule"];

export type WizardStep1 = {
  title: string;
  job_description: string;
  location: string;
  type: string; // "Full-Time" | "Contract" | "Freelance"
  start_date: string; // free-form ("ASAP" or ISO date string)
  compensation: string;
  hiring_manager_id: string | null;
  hiring_manager_name: string;
  hiring_manager_email: string;
  hiring_priorities: string;
  auto_rejection_threshold: number;
};

export type WizardStep2 = {
  email_keywords: string[];
  email_search_start_date: string; // ISO date (yyyy-mm-dd)
  auto_pull_schedule: AutoPullSchedule;
};

export type Criterion = {
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  is_disqualifier: boolean;
  full_points_rubric: string;
  /**
   * Short (≤ 14 words) condensed version of full_points_rubric used in
   * compact UI surfaces (candidate detail score breakdown, packet matrix
   * headers, recap views). Phase 3.11 addition. Optional for legacy
   * criteria — UI surfaces should fall back to truncating
   * full_points_rubric when summary is empty.
   */
  summary?: string;
  partial_points_rubric: string;
  is_manual?: boolean;
};

type State = {
  step1: WizardStep1 | null;
  step2: WizardStep2 | null;
  criteria: Criterion[] | null;
};

const state: State = { step1: null, step2: null, criteria: null };

// Step labels for the 3-step new-role wizard. Consumed by every step page
// with the shared <Stepper /> primitive (moved to src/components/ui/Stepper
// in Phase 5.9.1).
export const TS_WIZARD_STEPS = ["Role Details", "Search Setup", "Scorecard"] as const;

export const wizard = {
  get: () => state,
  setStep1: (s: WizardStep1) => {
    state.step1 = s;
  },
  setStep2: (s: WizardStep2) => {
    state.step2 = s;
  },
  setCriteria: (c: Criterion[]) => {
    state.criteria = c;
  },
  reset: () => {
    state.step1 = null;
    state.step2 = null;
    state.criteria = null;
  },
};
