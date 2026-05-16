-- Phase 5.2.3.D: notes_log CHECK widening + data migration.
--
-- Spec: OUTPUTS/phase-5-2-3-spec.md § 3.D. The shipped notes_log parent_type
-- CHECK is ('organization', 'person', 'venue') (initially ('organization',
-- 'person') from 5.1 + widened to add 'venue' in 5.2.2). After 5.2.3.A +
-- 5.2.3.B, the organization concept splits into client + vendor; the CHECK
-- needs to replace 'organization' with 'client' + 'vendor' AND any
-- existing rows with parent_type='organization' need to be redistributed
-- based on which table (clients vs vendors) their parent_id now lives in.
--
-- Defensive cleanup: any 'organization' rows whose parent_id no longer
-- exists in either table get deleted; the new CHECK would otherwise reject
-- them.
--
-- Depends on 5.2.3.A + 5.2.3.B (queries both tables).

BEGIN;

-- ============================================================================
-- Step 1: drop the old CHECK
-- ============================================================================

ALTER TABLE public.notes_log DROP CONSTRAINT IF EXISTS notes_log_parent_type_check;

-- ============================================================================
-- Step 2: redistribute existing 'organization' rows
-- ============================================================================

UPDATE public.notes_log
   SET parent_type = 'client'
 WHERE parent_type = 'organization'
   AND parent_id IN (SELECT id FROM public.clients);

UPDATE public.notes_log
   SET parent_type = 'vendor'
 WHERE parent_type = 'organization'
   AND parent_id IN (SELECT id FROM public.vendors);

-- Defensive cleanup: anything still tagged 'organization' is an orphan
-- (parent row no longer exists in either table). Drop to satisfy the new
-- CHECK below.
DELETE FROM public.notes_log
 WHERE parent_type = 'organization';

-- ============================================================================
-- Step 3: re-add the CHECK with the new value set
-- ============================================================================

ALTER TABLE public.notes_log
  ADD CONSTRAINT notes_log_parent_type_check
  CHECK (parent_type IN ('client', 'vendor', 'person', 'venue'));

COMMIT;
