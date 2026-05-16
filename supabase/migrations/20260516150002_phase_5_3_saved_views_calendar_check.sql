-- Phase 5.3: extend saved_views.entity_type CHECK to include 'calendar'.
--
-- Spec: OUTPUTS/phase-5-3-spec.md § 3e + § 6a. Per-user Calendar visibility
-- toggles (Deliverables / Mirror Holidays / shared Outlook / per-project)
-- persist via a saved_views row with entity_type = 'calendar', name =
-- '__calendar_default'. The existing CHECK allows project / task /
-- deliverable / organization / person / venue only; this widens it.
--
-- The shipped CHECK is inline (anonymous), so the auto-generated constraint
-- name follows Postgres convention: <table>_<column>_check ->
-- saved_views_entity_type_check.
--
-- Pure additive. No data migration (zero rows of entity_type = 'calendar'
-- pre-migration).

BEGIN;

ALTER TABLE public.saved_views
  DROP CONSTRAINT saved_views_entity_type_check;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_entity_type_check
  CHECK (entity_type IN (
    'project', 'task', 'deliverable',
    'organization', 'person', 'venue',
    'calendar'
  ));

COMMIT;
