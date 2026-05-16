-- Phase 5.2.3.C: FK reshapes (projects + people).
--
-- Spec: OUTPUTS/phase-5-2-3-spec.md § 3.C. After 5.2.3.B, the old
-- `projects.organization_id` and `people.organization_id` FKs both point
-- at the renamed `vendors` table (the rename preserved row IDs). We need
-- to:
--   - Flip `projects.organization_id` to point at `clients` (and rename
--     the column to `client_id`). Projects in the shipped seed all
--     referenced Client rows; the UUIDs preserved in 5.2.3.A still resolve.
--   - Flip `people.organization_id` to point at `clients` (rename column
--     to `client_id`). People who actually pointed at Vendor / Internal
--     rows get re-routed to a new nullable `vendor_id` FK; mutex CHECK
--     prevents both being set simultaneously (locked Q4: at most one
--     org type per person).
--   - Drop the people.affiliations array + the person_affiliation enum
--     (locked Q4: FK presence resolves type at query time; no
--     multi-affiliation case).
--
-- Depends on 5.2.3.A + 5.2.3.B (uses both clients and vendors as FK targets).

BEGIN;

-- ============================================================================
-- projects.organization_id -> projects.client_id (FK to clients)
-- ============================================================================
-- The shipped FK on projects is named `projects_client_id_fkey` (vestige of
-- the original 5.2.2 rename which created the FK against the freshly named
-- column; Postgres auto-named the constraint after the new column). Drop the
-- shipped name (also tolerate `projects_organization_id_fkey` defensively in
-- case any environment kept the older name).

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_client_id_fkey;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_organization_id_fkey;
ALTER TABLE public.projects RENAME COLUMN organization_id TO client_id;
ALTER INDEX IF EXISTS idx_projects_organization_id RENAME TO idx_projects_client_id;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

-- ============================================================================
-- people.organization_id -> people.client_id (FK to clients) + people.vendor_id
-- ============================================================================
-- Ordering is load-bearing: people rows attached to Vendor / Internal orgs
-- in 5.2.2 carry a `client_id` (renamed from organization_id) that now
-- points at a `vendors` row, not a `clients` row. We must redistribute
-- those values to `vendor_id` BEFORE adding the people.client_id -> clients
-- FK or it fails on the existing data (SQLSTATE 23503).

-- Step 1: drop the shipped FK + rename column. The FK still references the
-- renamed `vendors` table after 5.2.3.B; data is unchanged, just the column
-- name flips.
ALTER TABLE public.people DROP CONSTRAINT IF EXISTS people_organization_id_fkey;
ALTER TABLE public.people RENAME COLUMN organization_id TO client_id;
ALTER INDEX IF EXISTS people_org_idx RENAME TO people_client_idx;

-- Step 2: add vendor_id column (no FK yet -- the FK gets added at the end
-- once the column is populated correctly).
ALTER TABLE public.people ADD COLUMN vendor_id uuid;

-- Step 3: redistribute. Move people whose `client_id` (renamed from
-- organization_id) now points at a vendors row over to vendor_id; clear
-- client_id. After this UPDATE, every remaining non-null client_id resolves
-- to a clients row.
UPDATE public.people p
   SET vendor_id = p.client_id,
       client_id = NULL
 WHERE p.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p.client_id)
   AND EXISTS     (SELECT 1 FROM public.vendors v WHERE v.id = p.client_id);

-- Step 4: NOW add both FKs. Data already satisfies them.
ALTER TABLE public.people
  ADD CONSTRAINT people_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.people
  ADD CONSTRAINT people_vendor_id_fkey
  FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX people_vendor_idx
  ON public.people (vendor_id)
  WHERE vendor_id IS NOT NULL;

-- Step 5: mutex CHECK. A person ties to at most one org type. Both NULL is
-- fine (Unaffiliated or Venue-contact-only).
ALTER TABLE public.people
  ADD CONSTRAINT people_org_mutex_check
  CHECK (NOT (client_id IS NOT NULL AND vendor_id IS NOT NULL));

-- Step 6: drop the affiliations array + enum (locked Q4: no multi-affiliation case).
DROP INDEX IF EXISTS public.people_affiliation_gin_idx;
ALTER TABLE public.people DROP COLUMN affiliations;
DROP TYPE public.person_affiliation;

COMMIT;
