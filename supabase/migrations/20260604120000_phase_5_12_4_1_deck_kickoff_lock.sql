-- Phase 5.12.4.1: vs-generate-deck race fix.
--
-- Mirrors the Phase 5.12.1 vs_research_try_acquire_kickoff RPC fix
-- (`20260603160000_phase_5_12_1_hq_pool_source_and_research_kickoff_lock.sql`)
-- on the deck-generation surface. Pre-5.12.4.1 vs-generate-deck used a
-- non-atomic check-then-write of `brief_data.deck_generation_started_at`:
-- two near-simultaneous invocations (producer double-clicking Generate)
-- could both pass the 90s grace window check before either committed its
-- timestamp, then both run `pushVenuesToHq` and INSERT duplicate `venues`
-- rows (no UNIQUE constraint on venue identity columns). Codex adversarial
-- review surfaced the race; same TOCTOU shape vs-research-venues had
-- pre-5.12.1 (code-observations Edge #1).
--
-- The advisory lock prevents two concurrent invocations from both passing
-- the grace-window check before either commits its timestamp write. Lock
-- is auto-released at transaction end (the RPC's own transaction), so it
-- doesn't need to survive the edge function's lifetime. The persisted
-- timestamp is what gates subsequent invocations after this RPC returns.
--
-- Returns true if THIS invocation should proceed with deck generation
-- (Google Slides + pushVenuesToHq). Returns false if another invocation
-- holds the lock OR if a prior kickoff timestamp is within the grace
-- window.

CREATE OR REPLACE FUNCTION public.vs_deck_try_acquire_kickoff(
  target_scout_id uuid,
  grace_seconds int DEFAULT 90
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
  -- Derive a stable 64-bit lock key from the scout id under a separate
  -- namespace from vs-research:* so deck + research kickoffs for the same
  -- scout don't collide on the advisory lock space.
  lock_key := hashtextextended('vs-deck:' || target_scout_id::text, 0);

  -- Try to acquire the lock. If another transaction holds it, bail.
  IF NOT pg_try_advisory_xact_lock(lock_key) THEN
    RETURN false;
  END IF;

  -- We hold the lock. Read the current kickoff timestamp.
  SELECT brief_data->>'deck_generation_started_at' INTO started_at_raw
  FROM public.vs_scouts
  WHERE id = target_scout_id;

  -- If a prior kickoff is within the grace window, another (still in-
  -- flight or recently completed) invocation already won. Bail.
  IF started_at_raw IS NOT NULL THEN
    age_seconds := EXTRACT(EPOCH FROM (now() - started_at_raw::timestamptz));
    IF age_seconds < grace_seconds THEN
      RETURN false;
    END IF;
  END IF;

  -- Stamp our kickoff atomically + clear prior failure state so a retry
  -- from a failed run starts clean. Matches the pre-5.12.4.1 inline
  -- write at vs-generate-deck/index.ts lines 607-616.
  UPDATE public.vs_scouts
  SET brief_data = jsonb_set(
        COALESCE(brief_data, '{}'::jsonb),
        '{deck_generation_started_at}',
        to_jsonb(now()::text)
      ),
      pipeline_error = NULL
  WHERE id = target_scout_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.vs_deck_try_acquire_kickoff IS
  'Phase 5.12.4.1: atomic kickoff acquisition for vs-generate-deck. Uses '
  'pg_try_advisory_xact_lock + same-transaction read-and-write of '
  'brief_data.deck_generation_started_at to prevent the duplicate-invocation '
  'race surfaced by Codex adversarial review (mirrors the Phase 5.12.1 fix '
  'on vs-research-venues; code-observations Edge #1). Without this lock, two '
  'parallel deck-generate invocations could both pass the 90s grace check '
  'and INSERT duplicate venues rows via pushVenuesToHq (no UNIQUE constraint '
  'on venue identity columns).';

-- Lock down grants. The RPC has no client-side consumer; vs-generate-deck
-- calls it via the service-role client. Mirrors the vs_research_try_acquire_
-- kickoff posture (Phase 5.12.1).
REVOKE EXECUTE ON FUNCTION
  public.vs_deck_try_acquire_kickoff(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.vs_deck_try_acquire_kickoff(uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION
  public.vs_deck_try_acquire_kickoff(uuid, int) FROM authenticated;

GRANT EXECUTE ON FUNCTION
  public.vs_deck_try_acquire_kickoff(uuid, int)
  TO service_role;
