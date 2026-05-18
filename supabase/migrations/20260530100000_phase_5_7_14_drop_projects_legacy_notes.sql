-- Phase 5.7.14: drop projects.status_notes + projects.client_notes legacy
-- columns. UI consumers (ProjectDetail SELECT projection at L208 + the type
-- def at L103-104) are updated in the same feature-branch commit before
-- db push applies.
--
-- status_notes UI was replaced by InternalNotesEditor reading from notes_log
-- in 5.7.3 (migration 20260523100000 backfilled the existing column content
-- into notes_log rows). client_notes UI was removed in 5.7.7. Both columns
-- have been dead-data-on-disk since.
--
-- Dependency check: no triggers, views, RLS policies, or functions reference
-- these columns. Safe to drop.

ALTER TABLE public.projects DROP COLUMN IF EXISTS status_notes;
ALTER TABLE public.projects DROP COLUMN IF EXISTS client_notes;
