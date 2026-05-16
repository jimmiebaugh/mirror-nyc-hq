-- Phase 5.2.3.B: reshape organizations -> vendors.
--
-- Spec: OUTPUTS/phase-5-2-3-spec.md § 3.B. Four things land here, in order:
--   1. Tag existing 'Internal' rows with the 'Internal Partner' string in
--      tags[] (locked Q1: internal designation collapses into tags[], not
--      a column).
--   2. Delete migrated-out Client rows (they live in clients now per
--      5.2.3.A; the notes_log rows pointing at those IDs are reassigned
--      in 5.2.3.D before its CHECK constraint flip).
--   3. Drop the type column + the org_type enum.
--   4. Rename organizations -> vendors. Add `category_id uuid` FK to the
--      new vendor_categories lookup.
--
-- Depends on 5.2.3.A (the Client rows must already be copied into clients
-- before we delete them here; the DELETE is irreversible).

BEGIN;

-- ============================================================================
-- Step 1: tag existing Internal orgs with 'Internal Partner'
-- ============================================================================
-- Guarded against re-running by checking the tag isn't already present.

UPDATE public.organizations
   SET tags = COALESCE(tags, '{}'::text[]) || ARRAY['Internal Partner']
 WHERE type = 'Internal'
   AND NOT ('Internal Partner' = ANY(COALESCE(tags, '{}'::text[])));

-- ============================================================================
-- Step 2: drop migrated-out Client rows
-- ============================================================================
-- notes_log rows pointing at these IDs are re-tagged in 5.2.3.D; defensive
-- ON DELETE CASCADE is not set on notes_log.parent_id (it can't be -- the
-- column is polymorphic), so any orphan rows that reference now-deleted
-- client IDs in organizations get explicitly cleaned in 5.2.3.D step 2.

DELETE FROM public.organizations WHERE type = 'Client';

-- ============================================================================
-- Step 3: drop the type column + org_type enum
-- ============================================================================
-- The type column is no longer needed: Client rows live in clients now;
-- the remaining Vendor + Internal rows collapse into the renamed vendors
-- table with Internal designation living in tags[].
--
-- Drop the index that depends on the column first.

DROP INDEX IF EXISTS public.organizations_type_idx;
ALTER TABLE public.organizations DROP COLUMN type;
DROP TYPE public.org_type;

-- ============================================================================
-- Step 4: rename organizations -> vendors + add category_id
-- ============================================================================

ALTER TABLE public.organizations RENAME TO vendors;

-- Rename the PK index for tidiness; Postgres auto-named it
-- organizations_pkey on table creation.
ALTER INDEX IF EXISTS organizations_pkey RENAME TO vendors_pkey;
ALTER INDEX IF EXISTS organizations_city_idx RENAME TO vendors_city_idx;

-- New FK column to vendor_categories.
ALTER TABLE public.vendors
  ADD COLUMN category_id uuid REFERENCES public.vendor_categories(id) ON DELETE SET NULL;

CREATE INDEX vendors_category_idx
  ON public.vendors (category_id)
  WHERE category_id IS NOT NULL;

COMMIT;
