-- Phase 5.7.14: one-shot cleanup of notes_log polymorphic orphans.
--
-- notes_log.parent_type IN ('client', 'vendor', 'person', 'venue',
-- 'outlook_entry', 'task', 'deliverable', 'project'). Polymorphic FK
-- can't be enforced; task/deliverable deletes since 5.7.4/5.7.5 may have
-- left orphan rows.
--
-- One-shot DELETE: for each parent_type, anti-join to the parent table
-- and remove rows whose parent_id no longer exists. Wrapped in a single
-- transaction so a mid-flight error rolls back.
--
-- A standing AFTER DELETE trigger across 8 parent tables would prevent
-- future orphans but is brittle. Defer; if smoke surfaces orphan growth
-- as a real issue, lift the trigger approach in a later sub-phase.

BEGIN;

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'client'
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'vendor'
   AND NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'person'
   AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'venue'
   AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'outlook_entry'
   AND NOT EXISTS (SELECT 1 FROM public.outlook_entries o WHERE o.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'task'
   AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'deliverable'
   AND NOT EXISTS (SELECT 1 FROM public.deliverables d WHERE d.id = nl.parent_id);

DELETE FROM public.notes_log nl
 WHERE nl.parent_type = 'project'
   AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = nl.parent_id);

COMMIT;
