-- Phase 5.7.13: backfill legacy vendors.internal_rating into vendor_ratings,
-- then drop the legacy column.
--
-- Backfill maps each non-null internal_rating to a vendor_ratings row owned
-- by the vendor's created_by. Loses the "who set this" history (we don't
-- have it on the legacy row) but preserves the rating value itself. Rows
-- with NULL internal_rating or NULL created_by are skipped.
--
-- Column drop runs AFTER all UI consumers have moved to vendor_ratings.
-- See spec § 2 for the consumer list; all six are updated in the same
-- feature-branch commit before db push applies this migration.

INSERT INTO public.vendor_ratings (vendor_id, user_id, rating, created_at, updated_at)
SELECT v.id, v.created_by, v.internal_rating, v.created_at, v.updated_at
  FROM public.vendors v
 WHERE v.internal_rating IS NOT NULL
   AND v.created_by IS NOT NULL
ON CONFLICT (vendor_id, user_id) DO NOTHING;

ALTER TABLE public.vendors DROP COLUMN internal_rating;
