-- Phase 4.1-port follow-up: drop _jsonb_array_to_text_array helper.
--
-- The helper was created in the failed-attempt Phase 4.3.1 migration
-- (20260509025143) alongside `create_scout_with_brief`, used only by that
-- RPC. The Phase 4.1-port migration (20260512200000) dropped
-- `create_scout_with_brief` but missed this helper, leaving it as an orphan
-- on the remote DB (and surfaced in the regenerated types). This migration
-- is the one-line cleanup; surfaced by code-reviewer on Phase 4.1-port.

DROP FUNCTION IF EXISTS public._jsonb_array_to_text_array(jsonb);
