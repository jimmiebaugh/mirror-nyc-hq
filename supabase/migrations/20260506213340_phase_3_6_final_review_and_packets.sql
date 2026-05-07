-- ============================================================================
-- Phase 3.6: Final Review + Packet Generation
-- ============================================================================
-- 1. Augments `ts_final_reviews` with realtime-progress + packet metadata.
-- 2. Augments `ts_pull_rounds` with packet metadata (round-scoped packets).
-- 3. Adds the `packets` Storage bucket (admin-only).
-- 4. Adds `ts_final_reviews` to the supabase_realtime publication so the
--    FinalReviewLoading page can subscribe to step_progress updates.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Final review status enum
-- ----------------------------------------------------------------------------
CREATE TYPE public.ts_final_review_status AS ENUM ('generating', 'complete', 'failed');

-- ----------------------------------------------------------------------------
-- ts_final_reviews additions
-- ----------------------------------------------------------------------------
-- step_progress drives the FinalReviewLoading step list (aggregate / build / rank).
-- candidate_count is the resolved Master Pool size at generation time.
-- duration_seconds is wall-clock for the AI call + bookkeeping; used in history list.
-- error_message + error_log are surfaced on the Loading page when status = 'failed'.
-- claude_raw_response is kept for debugging; nullable, no UI dependency.
-- packet_* columns track the most recent packet generated FROM this review.

ALTER TABLE public.ts_final_reviews
  ADD COLUMN status public.ts_final_review_status NOT NULL DEFAULT 'generating',
  ADD COLUMN step_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN candidate_count integer,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN error_message text,
  ADD COLUMN error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN claude_raw_response jsonb,
  ADD COLUMN packet_url text,
  ADD COLUMN packet_top_n integer,
  ADD COLUMN packet_include_fast_track boolean,
  ADD COLUMN packet_generated_at timestamptz;

-- Index on (role_id, status, generated_at DESC) for the FinalReviewDetail
-- "load latest complete review for this role" query and the history list.
CREATE INDEX idx_ts_final_reviews_role_status_generated
  ON public.ts_final_reviews(role_id, status, generated_at DESC);

-- ----------------------------------------------------------------------------
-- ts_pull_rounds: round-scoped packet metadata
-- ----------------------------------------------------------------------------
ALTER TABLE public.ts_pull_rounds
  ADD COLUMN packet_url text,
  ADD COLUMN packet_top_n integer,
  ADD COLUMN packet_include_fast_track boolean,
  ADD COLUMN packet_generated_at timestamptz;

-- ----------------------------------------------------------------------------
-- ts_candidates.email_body_text — populated by ts-pull-candidates so the
-- packet's per-candidate email page renders with the original application
-- text. Nullable; existing candidates won't have it (no backfill). The
-- packet email page is skipped for any candidate where this is null.
-- ----------------------------------------------------------------------------
ALTER TABLE public.ts_candidates
  ADD COLUMN email_body_text text;

-- ----------------------------------------------------------------------------
-- Storage bucket: packets (admin-only RLS)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('packets', 'packets', false)
ON CONFLICT (id) DO NOTHING;

-- packets: admin only — both round packets and final review packets are
-- recruiter / hiring manager confidential. Never public.
CREATE POLICY storage_packets_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'packets' AND public.is_admin())
  WITH CHECK (bucket_id = 'packets' AND public.is_admin());

-- Service role bypasses RLS, so edge functions writing packets work as-is.

-- ----------------------------------------------------------------------------
-- Realtime: publish ts_final_reviews so the loading page can subscribe.
-- ----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.ts_final_reviews;
ALTER TABLE public.ts_final_reviews REPLICA IDENTITY FULL;

-- ----------------------------------------------------------------------------
-- Notes
-- ----------------------------------------------------------------------------
-- final_rankings shape (jsonb array, no schema change needed) is now:
--   [{ candidate_id, final_rank, final_tier, rationale, recruiter_note }]
-- where recruiter_note is a string[] (bullet list, max 3 items).
-- See docs/decisions.md § Phase 3.6 for the rationale.
