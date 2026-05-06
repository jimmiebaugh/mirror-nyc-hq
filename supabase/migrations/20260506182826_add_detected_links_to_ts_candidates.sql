-- ============================================================================
-- ts_candidates.detected_links: classified URL list extracted at pull time
-- ============================================================================
-- The pull pipeline extracts URLs from the candidate's email body, HTML
-- anchors, attachment text, and bare-domain mentions. The single best one
-- becomes ts_candidates.portfolio_path_or_url; the rest were being thrown
-- away. Persist them so the candidate-detail UI (Phase 3.5) can render an
-- "Other links" section grouped by type.
--
-- Shape: jsonb array of { url: string, type: string }, where type is one
-- of "vimeo_reel" | "drive_folder" | "portfolio_site" | "other" — matches
-- _shared/buildClaudeEvalRequest.ts's classifyDetectedUrls() output.
-- ============================================================================

ALTER TABLE public.ts_candidates
  ADD COLUMN detected_links jsonb NOT NULL DEFAULT '[]'::jsonb;
