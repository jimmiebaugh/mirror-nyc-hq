-- Phase 4.10.6-port: atomic state-reset RPC for the Deck Prep regenerate
-- flow.
--
-- Producer-flow context: when a producer clicks Generate Deck on a scout
-- that already has a successful prior deck, vs-generate-deck's idempotency
-- guards (current_step must be 'deck_prep', brief_data.deck_generation_started_at
-- must not be within the in-flight grace window) would silently no-op the
-- regenerate. The frontend reset was previously a read-then-write on
-- brief_data which has a TOCTOU race between the SELECT and the UPDATE.
--
-- This RPC does the read-modify-write atomically in a single statement
-- using the jsonb minus operator to strip `deck_generation_started_at`
-- from brief_data. SECURITY INVOKER so RLS on vs_scouts applies. The
-- function is idempotent: calling it on a scout that's never been deck-
-- generated is a no-op for the brief_data key but still resets the
-- other columns.

CREATE OR REPLACE FUNCTION reset_scout_for_deck_regenerate(
  target_scout_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.vs_scouts
  SET
    current_step = 'deck_prep',
    brief_data = COALESCE(brief_data, '{}'::jsonb) - 'deck_generation_started_at',
    status = 'in_progress',
    pipeline_error = NULL,
    last_touched_at = now()
  WHERE id = target_scout_id;
$$;

GRANT EXECUTE ON FUNCTION reset_scout_for_deck_regenerate(uuid)
  TO authenticated;
