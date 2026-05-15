-- Phase 5.1: notes_log (polymorphic across Organization + Person parents).
--
-- Append-only-with-delete log of Internal Notes shared by Organizations and
-- People. Both surfaces land in Phase 5.2, but the table is forward-compat
-- so the parent_type CHECK already permits both values today. Per locked
-- decisions § 3:
--   - Notes are immutable except for deletion (no UPDATE policy).
--   - Hard delete (row gone) allowed by the original author OR any admin.
--   - No tombstone, no "deleted by" trace.
--
-- `parent_type` is a CHECK constraint rather than a foreign key because
-- the polymorphic parent points at one of two future tables. The CHECK
-- plus the `(parent_type, parent_id)` index is sufficient for the planned
-- query patterns ("newest-first notes for this Organization | Person").

CREATE TABLE public.notes_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('organization', 'person')),
  parent_id   uuid NOT NULL,
  body        text NOT NULL,
  author_id   uuid NOT NULL REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_log_parent_idx
  ON public.notes_log (parent_type, parent_id, created_at DESC);

-- RLS: SELECT-all-authenticated, INSERT-self-author, DELETE-author-or-admin.
-- No UPDATE policy means UPDATE attempts are rejected at the row level even
-- though the underlying GRANT is absent below.

ALTER TABLE public.notes_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_log_select ON public.notes_log
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY notes_log_insert ON public.notes_log
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY notes_log_delete ON public.notes_log
  FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR public.is_admin()
  );

-- GRANTs per docs/conventions.md. No UPDATE column for authenticated since
-- notes are immutable; service_role gets ALL for ops + future migrations.

GRANT SELECT, INSERT, DELETE ON public.notes_log TO authenticated;
GRANT ALL                    ON public.notes_log TO service_role;
