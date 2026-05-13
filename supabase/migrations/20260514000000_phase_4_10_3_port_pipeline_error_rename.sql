-- Phase 4.10.3-port: rename vs_scouts.research_error to vs_scouts.pipeline_error.
--
-- The column was added at 4.5-port for vs-research-venues failures. 4.7.2-port
-- (vs-compile-summaries) and 4.8.2-port (vs-generate-deck) reused the same
-- column for compile + deck errors without renaming. The "research_error" name
-- has been misleading since 4.7.2; this rename brings it in line with actual
-- usage as the single AI-pipeline error channel.
--
-- Plain ALTER ... RENAME COLUMN preserves all existing values; scouts that
-- already have research_error set will keep their text under pipeline_error.

ALTER TABLE public.vs_scouts RENAME COLUMN research_error TO pipeline_error;

COMMENT ON COLUMN public.vs_scouts.pipeline_error IS
  'Persisted error channel for the EdgeRuntime.waitUntil + Realtime flow on vs-research-venues / vs-compile-summaries / vs-generate-deck. Format: "<CODE>: <message>". Cleared on success and by start_over_scout. Renamed from research_error at 4.10.3-port.';
