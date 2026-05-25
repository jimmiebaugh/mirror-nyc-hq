-- Phase 5.12.1: HQ Venues pool in VS sourcing + vs-research-venues race fix.
--
-- Two coupled changes:
--   1. Extend vs_candidate_venues.source CHECK to allow 'hq_pool' for
--      candidates inserted from the HQ Venues database during research.
--   2. Add vs_research_try_acquire_kickoff RPC: atomically acquires an
--      advisory lock + reads + writes brief_data.research_started_at so
--      two concurrent invocations can't both pass the 360s grace window
--      check (code-observations Edge #1; confirmed-live token double-spend).

-- ============================================================================
-- 1. Extend source CHECK to add 'hq_pool'.
-- ============================================================================

ALTER TABLE public.vs_candidate_venues
  DROP CONSTRAINT IF EXISTS vs_candidate_venues_source_check;

ALTER TABLE public.vs_candidate_venues
  ADD CONSTRAINT vs_candidate_venues_source_check
  CHECK (source IN ('sheet', 'research', 'manual', 'hq_pool'));

-- No row backfill: no existing row has source = 'hq_pool' yet. New rows
-- inserted by vs-research-venues post-5.12.1 are the first consumers.

-- ============================================================================
-- 2. Advisory-lock kickoff RPC for vs-research-venues.
-- ============================================================================

-- Replaces the non-atomic check-then-write at vs-research-venues lines
-- 602-621 (pre-5.12.1). The advisory lock prevents two concurrent
-- invocations from both passing the grace-window check before either
-- commits its timestamp write (code-observations Edge #1; confirmed live
-- on scout 25b5c921, 4 boots / 2 parallel Claude runs, token double-spend).
--
-- Returns true if THIS invocation should proceed with HQ pool + Phase A +
-- Phase B work. Returns false if another invocation holds the lock OR if a
-- prior kickoff timestamp is within the grace window (someone else just
-- started).
--
-- Lock is auto-released at transaction end (the RPC's own transaction), so
-- it doesn't need to survive the edge function's lifetime. The persisted
-- timestamp is what gates subsequent invocations after this RPC returns.

CREATE OR REPLACE FUNCTION public.vs_research_try_acquire_kickoff(
  target_scout_id uuid,
  grace_seconds int DEFAULT 360
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_key bigint;
  started_at_raw text;
  age_seconds numeric;
BEGIN
  -- Derive a stable 64-bit lock key from the scout id. hashtextextended
  -- with seed 0 is deterministic; collisions across scouts are astronomically
  -- unlikely (full 64-bit space).
  lock_key := hashtextextended('vs-research:' || target_scout_id::text, 0);

  -- Try to acquire the lock. If another transaction holds it, bail.
  IF NOT pg_try_advisory_xact_lock(lock_key) THEN
    RETURN false;
  END IF;

  -- We hold the lock. Read the current kickoff timestamp.
  SELECT brief_data->>'research_started_at' INTO started_at_raw
  FROM public.vs_scouts
  WHERE id = target_scout_id;

  -- If a prior kickoff is within the grace window, another (now-completed)
  -- invocation already won. Bail.
  IF started_at_raw IS NOT NULL THEN
    age_seconds := EXTRACT(EPOCH FROM (now() - started_at_raw::timestamptz));
    IF age_seconds < grace_seconds THEN
      RETURN false;
    END IF;
  END IF;

  -- Stamp our kickoff atomically + clear prior failure state so a retry
  -- from a failed run starts clean.
  UPDATE public.vs_scouts
  SET brief_data = jsonb_set(
        COALESCE(brief_data, '{}'::jsonb),
        '{research_started_at}',
        to_jsonb(now()::text)
      ),
      pipeline_error = NULL
  WHERE id = target_scout_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.vs_research_try_acquire_kickoff IS
  'Phase 5.12.1: atomic kickoff acquisition for vs-research-venues. Uses '
  'pg_try_advisory_xact_lock + same-transaction read-and-write of '
  'brief_data.research_started_at to prevent the duplicate-invocation '
  'race that double-spent Claude tokens (code-observations Edge #1).';

-- Lock down grants. The RPC has no client-side consumer; vs-research-venues
-- calls it via the service-role client. Granting authenticated would let any
-- signed-in user reset another scout's kickoff state since the function does
-- not enforce caller-id ownership.
REVOKE EXECUTE ON FUNCTION
  public.vs_research_try_acquire_kickoff(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.vs_research_try_acquire_kickoff(uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION
  public.vs_research_try_acquire_kickoff(uuid, int) FROM authenticated;

GRANT EXECUTE ON FUNCTION
  public.vs_research_try_acquire_kickoff(uuid, int)
  TO service_role;
