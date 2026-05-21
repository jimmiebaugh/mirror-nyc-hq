-- Phase 5.9.1: shared bulk-import primitive tables.
--
-- Two umbrella tables that back the cross-cutting bulk-import edge function
-- + UI (the per-entity Project / Vendor / Venue handlers register in
-- 5.9.2 / .3 / .4; the audit page is 5.9.5).
--
-- - bulk_import_sessions: immutable audit trail; one row per committed
--   import (or failed-rollback for incident traceability). Read by the
--   audit page + per-entity list-page filter chip; written only by the
--   edge function via service-role.
-- - bulk_import_drafts: autosave state, one row per (author, entity_type)
--   per the v1 single-draft constraint. Author-only RLS; the admin-only
--   gate lives at the route level (spec § 11 test #23).
--
-- Both reference public.users(id). Per Phase 5.8.8.1 (auth-model.md
-- § 5.8.8), every FK pointing at public.users.id MUST be ON UPDATE
-- CASCADE so the handle_new_user pre-provision swap UPDATE doesn't
-- FK-violate when a pre-provisioned user has any attachments.

BEGIN;

-- bulk_import_sessions: audit trail of every committed import.

CREATE TABLE public.bulk_import_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN ('project', 'vendor', 'venue')),
  actor        uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  row_count    integer NOT NULL CHECK (row_count >= 0),
  created_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_set   text[] NOT NULL DEFAULT '{}'::text[],
  status       text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'failed_rollback')),
  committed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bulk_import_sessions_history_idx
  ON public.bulk_import_sessions (entity_type, committed_at DESC);

CREATE INDEX bulk_import_sessions_actor_idx
  ON public.bulk_import_sessions (actor, committed_at DESC);

ALTER TABLE public.bulk_import_sessions ENABLE ROW LEVEL SECURITY;

-- SELECT admin only; INSERT via service role only (the edge function
-- writes with the service-role client); no UPDATE / DELETE policies
-- (audit table, immutable).
CREATE POLICY bulk_import_sessions_select_admin
  ON public.bulk_import_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.bulk_import_sessions TO authenticated;
GRANT ALL    ON public.bulk_import_sessions TO service_role;

-- bulk_import_drafts: autosave state, one per (author, entity_type).

CREATE TABLE public.bulk_import_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author      uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'vendor', 'venue')),
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (author, entity_type)
);

CREATE TRIGGER trg_bulk_import_drafts_updated_at
  BEFORE UPDATE ON public.bulk_import_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.updated_at_auto();

ALTER TABLE public.bulk_import_drafts ENABLE ROW LEVEL SECURITY;

-- Author-only for all operations. The admin-only gate lives at the
-- route level (AdminRoute on /settings/bulk-import/:entity). Spec § 11
-- test #23: non-admins reaching the table directly via SQL have no
-- consumer (no UI path to commit a draft), so the route gate is
-- sufficient and adding an admin RLS predicate here would complicate
-- author-scoped queries unnecessarily.
CREATE POLICY bulk_import_drafts_author_all
  ON public.bulk_import_drafts
  FOR ALL
  TO authenticated
  USING (author = auth.uid())
  WITH CHECK (author = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_import_drafts TO authenticated;
GRANT ALL                            ON public.bulk_import_drafts TO service_role;

COMMIT;
