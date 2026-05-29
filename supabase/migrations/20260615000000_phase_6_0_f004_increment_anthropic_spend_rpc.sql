-- Phase 6.0 (F004): atomic Anthropic-spend increment.
--
-- Replaces the non-atomic read-modify-write in supabase/functions/_shared/
-- anthropic.ts trackSpendAndAlert. Concurrent callClaude invocations (Venue
-- Scout fans callClaude out via Promise.all) raced
-- global_settings.anthropic_spend_current_month_usd: each read the same
-- `before`, and the last UPDATE won, silently dropping the others' cost. Two
-- calls straddling the cap could also both skip (or both fire) the
-- cap-crossing email. The append-only anthropic_call_log keeps exact per-call
-- cost, so only this rollup counter was lossy.
--
-- This SECURITY DEFINER function does the increment under a row lock
-- (SELECT ... FOR UPDATE serializes concurrent callers in READ COMMITTED, so
-- each sees the prior commit's value as its `before`) and atomically sets
-- cap_alert_sent_this_month iff THIS call crosses the cap, returning the
-- pre/post values so exactly one caller emails the alert.
--
-- Invoked only by the edge tree via the service-role client (no frontend
-- caller, no caller-ownership check) -> conventions.md RPC posture pattern 2:
-- SECURITY DEFINER + search_path pinned + EXECUTE revoked from
-- PUBLIC/anon/authenticated, granted to service_role only. Mirrors
-- vs_research_try_acquire_kickoff (Phase 5.12.1).

CREATE OR REPLACE FUNCTION public.increment_anthropic_spend(p_cost numeric)
RETURNS TABLE(before_usd numeric, after_usd numeric, cap_usd numeric, just_crossed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_before numeric;
  v_cap numeric;
  v_alerted boolean;
  v_after numeric;
  v_just boolean;
BEGIN
  SELECT id, anthropic_spend_current_month_usd, anthropic_spend_cap_monthly_usd, cap_alert_sent_this_month
    INTO v_id, v_before, v_cap, v_alerted
    FROM public.global_settings
    LIMIT 1
    FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN; -- no settings row; nothing to track
  END IF;

  v_before := COALESCE(v_before, 0);
  v_after := v_before + p_cost;
  v_just := COALESCE(v_cap, 0) > 0
    AND v_before < v_cap
    AND v_after >= v_cap
    AND NOT COALESCE(v_alerted, false);

  UPDATE public.global_settings
     SET anthropic_spend_current_month_usd = v_after,
         cap_alert_sent_this_month = CASE WHEN v_just THEN true ELSE cap_alert_sent_this_month END
   WHERE id = v_id;

  before_usd := v_before;
  after_usd := v_after;
  cap_usd := v_cap;
  just_crossed := v_just;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_anthropic_spend(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_anthropic_spend(numeric) TO service_role;
