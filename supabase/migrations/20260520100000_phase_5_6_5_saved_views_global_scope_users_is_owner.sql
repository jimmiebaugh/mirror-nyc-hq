-- Phase 5.6.5: Global default views (owner admin feature).
--
-- Adds `scope` to `saved_views`, `is_owner` to `users`, widens the
-- `saved_views.entity_type` CHECK to add `vendor` + `client`, and replaces
-- the four `saved_views` RLS policies with scope-aware versions that allow
-- every authenticated user to SELECT global rows while restricting global
-- INSERT/UPDATE/DELETE to owners.
--
-- Spec: OUTPUTS/phase-5-6-5-spec.md § 5. Decisions log: § 14.
--
-- Pure additive on `users` (new boolean column defaults to false). Pure
-- additive on `saved_views.scope` (NOT NULL DEFAULT 'user' covers existing
-- rows). The entity_type CHECK widens (zero rows of 'vendor' or 'client'
-- in production today, so no backfill risk). RLS rewrite is DROP/CREATE
-- because the existing policies are scope-naive.

BEGIN;

-- 1) users.is_owner column + backfill the owner.
ALTER TABLE public.users
  ADD COLUMN is_owner boolean NOT NULL DEFAULT false;

UPDATE public.users
  SET is_owner = true
  WHERE email = 'jimmie@mirrornyc.com';

-- 2) saved_views.scope column.
ALTER TABLE public.saved_views
  ADD COLUMN scope text NOT NULL DEFAULT 'user'
  CHECK (scope IN ('user', 'global'));

-- Partial index speeds up the global-default lookup
-- (entity_type filtered).
CREATE INDEX saved_views_scope_default_idx
  ON public.saved_views (scope, entity_type)
  WHERE scope = 'global' AND is_default = true;

-- 2b) Widen saved_views.entity_type CHECK to add 'vendor' and 'client'.
-- The shipped list pages have been passing entityType="vendor" /
-- entityType="client" to SavedViewsDropdown since 5.2.3 (when clients +
-- vendors split from organizations), but the CHECK constraint rejected
-- those values silently. Zero rows in production today so no backfill
-- risk. 'organization' stays in the CHECK as a legacy value (no
-- migration path to drop it cleanly; can be removed in a future
-- cleanup pass).
ALTER TABLE public.saved_views
  DROP CONSTRAINT IF EXISTS saved_views_entity_type_check;

ALTER TABLE public.saved_views
  ADD CONSTRAINT saved_views_entity_type_check
  CHECK (entity_type IN (
    'project', 'task', 'deliverable',
    'organization',          -- legacy, pre-5.2.3; kept for back-compat
    'vendor', 'client',      -- 5.2.3 split successors; now valid here
    'person', 'venue',
    'calendar'               -- added in 5.3
  ));

-- 3) Replace the four saved_views RLS policies with scope-aware versions.
DROP POLICY IF EXISTS saved_views_select ON public.saved_views;
DROP POLICY IF EXISTS saved_views_insert ON public.saved_views;
DROP POLICY IF EXISTS saved_views_update ON public.saved_views;
DROP POLICY IF EXISTS saved_views_delete ON public.saved_views;

CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR scope = 'global');

CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (
    (scope = 'user' AND user_id = auth.uid())
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = auth.uid()) = true)
  );

CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE TO authenticated
  USING (
    (scope = 'user' AND user_id = auth.uid())
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = auth.uid()) = true)
  )
  WITH CHECK (
    (scope = 'user' AND user_id = auth.uid())
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = auth.uid()) = true)
  );

CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE TO authenticated
  USING (
    (scope = 'user' AND user_id = auth.uid())
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = auth.uid()) = true)
  );

COMMIT;
