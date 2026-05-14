-- Phase 4 Revision - Intake: add a `brief` step to the vs_scouts.current_step
-- state machine and make it the default for new scouts.
--
-- Phase 4.3-port shipped a single-page Brief and left `current_step` at
-- `sheet_prompt` for new rows (the brief intake had no dedicated step value).
-- The Phase 4 Revision rebuilds intake as a 3-step stepper; `brief` is the
-- in-flight intake step. Step 3's "Confirm & Continue" flips `brief` ->
-- `sheet_prompt`, so the rest of the state machine is unchanged.
--
-- Additive: existing rows keep whatever `current_step` they already have.
-- Scouts currently on `sheet_prompt` have already passed intake under the
-- old single-page flow and stay there.

ALTER TABLE vs_scouts DROP CONSTRAINT vs_scouts_current_step_check;

ALTER TABLE vs_scouts
  ADD CONSTRAINT vs_scouts_current_step_check
  CHECK (current_step IN (
    'brief',
    'sheet_prompt',
    'sheet_upload',
    'researching',
    'sourcing_report',
    'shortlist',
    'review_selects',
    'compiling',
    'deck_prep',
    'completed'
  ));

ALTER TABLE vs_scouts ALTER COLUMN current_step SET DEFAULT 'brief';
