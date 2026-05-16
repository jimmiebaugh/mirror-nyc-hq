-- Phase 5.2.2.A: rename clients -> organizations + add type column + Org
-- fields per OUTPUTS/phase-5-2-spec.md § 4e (locked Q3).
--
-- The shipped `clients` table becomes the canonical `organizations` table.
-- Existing rows are preserved verbatim; the default `type` column value
-- (`Client`) carries every existing row into the renamed schema as a Client
-- without data movement.
--
-- RLS / GRANTs / indexes / triggers attached to the old `clients` table
-- carry to the renamed table by table OID. Per Postgres semantics, a
-- RENAME TABLE preserves dependent objects (policies, triggers, indexes,
-- grants) without recreation. Policy names themselves do NOT auto-rename
-- (they keep their original `clients_*` identifiers), but they continue
-- enforcing the same access posture on the renamed table. The shipped
-- DELETE policy is admin-only; SELECT / INSERT / UPDATE are all-auth.
--
-- The FK rename (`projects.client_id` -> `projects.organization_id`) is the
-- hot-path edit: every Supabase select string in `src/` that joins via
-- `client:clients(...)` and every filter / payload that names `client_id`
-- has to flip in the same commit set.
--
-- This file was recreated in Phase 5.2.1 Revision after the halted 5.2.2
-- worktree was deleted. The SQL below matches what was applied to the live
-- linked Supabase project on 2026-05-15 (migration 20260515140000 is
-- registered in supabase_migrations.schema_migrations); `supabase migration
-- repair --status applied 20260515140000` registers this local file as
-- matching the already-applied remote without rerunning.

BEGIN;

-- ============================================================================
-- 1. Rename the table + FK column
-- ============================================================================

ALTER TABLE public.clients RENAME TO organizations;
ALTER TABLE public.projects RENAME COLUMN client_id TO organization_id;

-- The existing btree index `idx_projects_client_id` survives the column
-- rename (Postgres keeps the index attached to the column, OID-stable),
-- but its identifier is now misleading. Rename for grep-ability.
ALTER INDEX IF EXISTS public.idx_projects_client_id RENAME TO idx_projects_organization_id;

-- ============================================================================
-- 2. New org_type enum + Phase 5.2.2 columns
-- ============================================================================

CREATE TYPE public.org_type AS ENUM ('Client', 'Vendor', 'Internal');

ALTER TABLE public.organizations
  ADD COLUMN type            public.org_type NOT NULL DEFAULT 'Client',
  ADD COLUMN city            text,
  ADD COLUMN capabilities    text[] NOT NULL DEFAULT '{}',
                                          -- Vendor-side: "Custom Fabrication",
                                          -- "Large Format Print", etc. Free-text
                                          -- in 5.2.2; future sub-phase may
                                          -- promote to a lookup.
  ADD COLUMN website_url     text,
  ADD COLUMN tags            text[] NOT NULL DEFAULT '{}',
  ADD COLUMN internal_rating int CHECK (internal_rating BETWEEN 0 AND 5);
                                          -- Vendor-only field. Visible to all
                                          -- Standard users per Surface 10 detail.
                                          -- NULL for Client + Internal records.
                                          -- Admin-write-only RLS gating deferred
                                          -- to 5.4 (per spec § 0d).

-- The shipped clients table carries a `notes` text column. The 5.2.2 wireframe
-- uses Internal Notes (append-only via notes_log), not a single text column.
-- Rename to `legacy_notes` so existing rows preserve any content; a future
-- cleanup can backfill into notes_log + drop the column.
ALTER TABLE public.organizations RENAME COLUMN notes TO legacy_notes;

CREATE INDEX organizations_type_idx ON public.organizations (type);
CREATE INDEX organizations_city_idx ON public.organizations (city) WHERE city IS NOT NULL;

-- ============================================================================
-- 3. Activity log trigger
-- ============================================================================
-- No clients-side trigger shipped in initial_schema.sql, so this is the
-- first activity_log_writer attachment for this table. The function was
-- extended in Phase 5.2.1.B with a TG_OP = 'DELETE' branch, so AFTER DELETE
-- writes a `deleted` row + payload {old: to_jsonb(OLD)}.

CREATE TRIGGER trg_activity_log_organizations
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

COMMIT;
