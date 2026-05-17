-- Phase 5.6.4.1: widen notes_log parent_type CHECK to include 'outlook_entry'.
--
-- Background: outlook_entries currently has a single text `notes` column
-- (Phase 5.3 spec § 4b). Smoke-test feedback asked for the additive
-- per-entry-row notes pattern that lives on Client / Vendor / Person /
-- Venue detail surfaces (Internal Notes editor backed by notes_log).
-- This migration widens the parent_type CHECK so InternalNotesEditor can
-- write parent_type='outlook_entry' rows.
--
-- The existing outlook_entries.notes column is left in place for two reasons:
--   1. Pre-5.6.4.1 entries may have notes content in that column. Migrating
--      them into notes_log would need an author + timestamp we don't have
--      (the column was free-text with no provenance).
--   2. Dropping a column needs a separate consideration cycle (RLS / type
--      regen / app reads); deferring keeps this migration additive.
-- A follow-on phase can backfill + drop the column once the new editor has
-- proven stable in production.
--
-- Reversibility: additive CHECK widening only. Reversed by dropping the
-- constraint + re-adding the prior 4-value form (any existing
-- parent_type='outlook_entry' rows would need to be cleared first; safe to
-- defer that cleanup decision to the reverse-migration author).

BEGIN;

ALTER TABLE public.notes_log DROP CONSTRAINT IF EXISTS notes_log_parent_type_check;

ALTER TABLE public.notes_log
  ADD CONSTRAINT notes_log_parent_type_check
  CHECK (parent_type IN ('client', 'vendor', 'person', 'venue', 'outlook_entry'));

COMMIT;
