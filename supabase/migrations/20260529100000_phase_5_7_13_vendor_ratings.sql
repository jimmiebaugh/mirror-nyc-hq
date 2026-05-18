-- Phase 5.7.13: per-user vendor ratings table.
--
-- Per plan § 13.A + § 13.B: replaces admin-curated vendors.internal_rating
-- with a per-user-rating + team-aggregate model. PK (vendor_id, user_id)
-- enforces one rating per user per vendor; UPSERT pattern when a user
-- changes their rating. RLS open-authenticated SELECT (aggregate needs
-- cross-user reads), self-only INSERT / UPDATE / DELETE. No activity-log
-- trigger (auxiliary to vendors, mirrors vendor_files posture).

CREATE TABLE public.vendor_ratings (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating    int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, user_id)
);

CREATE INDEX vendor_ratings_vendor_idx ON public.vendor_ratings (vendor_id);

ALTER TABLE public.vendor_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_ratings_select_authenticated ON public.vendor_ratings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vendor_ratings_insert_self ON public.vendor_ratings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY vendor_ratings_update_self ON public.vendor_ratings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY vendor_ratings_delete_self ON public.vendor_ratings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_ratings TO authenticated;
GRANT ALL ON public.vendor_ratings TO service_role;

CREATE TRIGGER trg_vendor_ratings_updated_at
  BEFORE UPDATE ON public.vendor_ratings
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

COMMENT ON TABLE public.vendor_ratings IS
  'Phase 5.7.13: per-user vendor ratings. Replaces the admin-curated '
  'vendors.internal_rating column with a per-user-rating + team-aggregate '
  'model. PK (vendor_id, user_id) enforces one rating per user per vendor. '
  'Open-authenticated SELECT (aggregate needs cross-user reads); '
  'self-only INSERT / UPDATE / DELETE. No activity-log trigger.';
