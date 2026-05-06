-- ============================================================================
-- Realtime: publish ts_pull_rounds changes
-- ============================================================================
-- The PullDetail page subscribes to UPDATE events on ts_pull_rounds via
-- supabase.channel().on('postgres_changes', ...). For those events to fire,
-- the table has to be in the `supabase_realtime` publication. Set REPLICA
-- IDENTITY FULL so payload.old also carries the previous row (helps with
-- diff-aware UI patterns later).
-- ============================================================================

ALTER TABLE public.ts_pull_rounds REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ts_pull_rounds;
