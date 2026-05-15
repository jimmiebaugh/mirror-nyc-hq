-- Phase 5.2.1.C: saved_views table.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4c. Per-user persisted filter / view
-- state for every HQ Core database list page. One row per saved view; the
-- "active default" per (user_id, entity_type) is enforced in app code (the
-- spec calls out that a unique partial index isn't worth the complexity for
-- 5.2.1; app-side multi-row upsert in a transaction handles the toggle).
--
-- RLS is per-user (USING user_id = auth.uid()) since saved views are
-- personal preferences, not shared team state. Unlike every other HQ Core
-- table, no other user can read another user's saved views.

BEGIN;

CREATE TABLE public.saved_views (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entity_type    text NOT NULL
                 CHECK (entity_type IN (
                   'project', 'task', 'deliverable',
                   'organization', 'person', 'venue'
                 )),
  name           text NOT NULL,
  view_kind      text NOT NULL
                 CHECK (view_kind IN ('list', 'board', 'timeline', 'calendar')),
  filter_state   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Shape: { connector: 'AND'|'OR', chips: [{field, op, value}],
  --          sort?: {field, dir}, columns?: [string] }

  is_default     boolean NOT NULL DEFAULT false,
  -- One per (user_id, entity_type) max; enforced in app via a transactional
  -- "clear then set" upsert, not at the DB level.

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_views_user_entity_idx
  ON public.saved_views (user_id, entity_type);

CREATE TRIGGER trg_saved_views_updated_at
  BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;
GRANT ALL                            ON public.saved_views TO service_role;

COMMIT;
