// Phase 4 Revision - Intake: in-memory store for the 3-step brief flow.
//
// The brief is one logical form spanning BriefEvent / BriefVenue / BriefReport.
// Step 1's Continue persists to the DB before navigating, but Step 2's Back
// must "preserve form state in memory" (spec § 5) -- so a producer who edits
// Step 2, clicks Back, then Continue doesn't lose the Step-2 edits. This
// module-level store carries the working form across those page mounts,
// keyed by scoutId so switching scouts reloads cleanly.
//
// Same plain-object pattern as src/lib/talent-scout/wizardStore.ts (resets on
// a full page reload; no persistence layer). React rendering is driven by each
// page's local useState; this store is the cross-page hand-off only.

import type { BriefFormState } from "./briefForm";

type IntakeState = {
  scoutId: string | null;
  form: BriefFormState | null;
  // Baseline for dirty-tracking across the whole intake. Updated on seed and
  // on every successful persist.
  initial: BriefFormState | null;
};

const state: IntakeState = { scoutId: null, form: null, initial: null };

export const briefIntake = {
  /** Cached working form + baseline for this scout, or null if not loaded. */
  get(scoutId: string): { form: BriefFormState; initial: BriefFormState } | null {
    if (state.scoutId === scoutId && state.form && state.initial) {
      return { form: state.form, initial: state.initial };
    }
    return null;
  },
  /** Seed after a fresh DB load. Baseline == form. */
  seed(scoutId: string, form: BriefFormState) {
    state.scoutId = scoutId;
    state.form = form;
    state.initial = form;
  },
  /** Update the working form (on every field change). Baseline untouched. */
  setForm(scoutId: string, form: BriefFormState) {
    if (state.scoutId !== scoutId) {
      state.scoutId = scoutId;
      state.initial = form;
    }
    state.form = form;
  },
  /** After a successful persist: the new baseline == the persisted form. */
  commit(scoutId: string, form: BriefFormState) {
    state.scoutId = scoutId;
    state.form = form;
    state.initial = form;
  },
  /** Clear the cache (e.g. after Step 3 confirm advances the scout). */
  reset() {
    state.scoutId = null;
    state.form = null;
    state.initial = null;
  },
};
