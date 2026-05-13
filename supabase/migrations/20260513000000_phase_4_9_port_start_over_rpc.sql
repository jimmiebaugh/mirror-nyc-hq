-- Phase 4.9-port: start_over_scout RPC for the Scout Settings Danger Zone.
-- Transactional cascade-delete of candidate venues (photos cascade via FK)
-- + reset of scout state back to sheet_prompt.
--
-- Keeps: brief fields, project_id, generated_decks (history), uploaded_files
-- in brief_data.
-- Resets: current_step, status, research_error, derived_columns,
-- sheet_storage_path, deck_order, brief_data idempotency timestamps.

CREATE OR REPLACE FUNCTION public.start_over_scout(target_scout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_brief_data jsonb;
BEGIN
  -- Cascade-delete candidate venues. Photos cascade via FK ON DELETE CASCADE
  -- (verified at the 4.1-port migration: vs_venue_photos.candidate_venue_id
  -- FK to vs_candidate_venues.id ON DELETE CASCADE).
  DELETE FROM public.vs_candidate_venues WHERE scout_id = target_scout_id;

  -- Strip idempotency timestamps from brief_data (keep producer-entered keys
  -- like uploaded_files). The three timestamps are the keys vs-* edge
  -- functions use as 90-second-grace idempotency tokens; clearing them
  -- ensures the next sourcing run won't be short-circuited.
  SELECT brief_data INTO v_brief_data
  FROM public.vs_scouts
  WHERE id = target_scout_id;
  v_brief_data := COALESCE(v_brief_data, '{}'::jsonb)
    - 'research_started_at'
    - 'compile_started_at'
    - 'deck_generation_started_at';

  -- Reset scout state. generated_decks history preserved on purpose; the
  -- post-completion nav strip can still surface prior deck links if the
  -- producer re-completes the scout.
  UPDATE public.vs_scouts SET
    current_step = 'sheet_prompt',
    status = 'draft',
    research_error = null,
    derived_columns = '[]'::jsonb,
    sheet_storage_path = null,
    deck_order = '[]'::jsonb,
    brief_data = v_brief_data,
    last_touched_at = now()
  WHERE id = target_scout_id;

  RETURN jsonb_build_object('scout_id', target_scout_id);
END;
$$;

COMMENT ON FUNCTION public.start_over_scout IS
  'Phase 4.9-port: reset a scout back to sheet_prompt. Cascade-deletes vs_candidate_venues (photos cascade via FK). Keeps brief fields, project_id, generated_decks history, brief_data.uploaded_files. Resets current_step, status, research_error, derived_columns, sheet_storage_path, deck_order, brief_data idempotency timestamps. SECURITY INVOKER.';

GRANT EXECUTE ON FUNCTION public.start_over_scout(uuid) TO authenticated;
