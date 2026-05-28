-- Phase 5.15.3: extend anthropic_spend_breakdown with a window selector.
--
-- Adds window_kind ('month' | 'year') alongside the existing date anchor.
-- Empty-arg calls still default to current calendar month (backwards
-- compatible at the call-site level; no extant 5.15.x caller passes args
-- after this ship — the three Settings consumers all pass window_kind).
--
-- The old single-arg signature must be dropped explicitly. CREATE OR REPLACE
-- with a different signature creates a new function alongside the old one;
-- both would coexist and PostgREST resolution would be ambiguous.

BEGIN;

DROP FUNCTION IF EXISTS public.anthropic_spend_breakdown(text);

CREATE FUNCTION public.anthropic_spend_breakdown(
  window_kind text DEFAULT 'month',
  window_iso  text DEFAULT NULL
)
RETURNS TABLE (
  app             text,
  fn_name         text,
  calls           bigint,
  total_cost_usd  numeric,
  avg_cost_usd    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_anchor timestamptz;
  v_start  timestamptz;
  v_end    timestamptz;
BEGIN
  -- Admin gate. SECURITY DEFINER bypasses RLS; enforce via the canonical
  -- is_admin() helper (Phase 5.15 pattern).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'anthropic_spend_breakdown: admin only';
  END IF;

  IF window_iso IS NULL THEN
    v_anchor := now();
  ELSE
    v_anchor := window_iso::timestamptz;
  END IF;

  IF window_kind = 'year' THEN
    v_start := date_trunc('year', v_anchor);
    v_end   := v_start + interval '1 year';
  ELSIF window_kind = 'month' THEN
    v_start := date_trunc('month', v_anchor);
    v_end   := v_start + interval '1 month';
  ELSE
    RAISE EXCEPTION 'anthropic_spend_breakdown: window_kind must be ''month'' or ''year'' (got %)', window_kind;
  END IF;

  RETURN QUERY
    SELECT
      l.app,
      l.fn_name,
      count(*)::bigint                       AS calls,
      coalesce(sum(l.cost_usd), 0)::numeric  AS total_cost_usd,
      coalesce(avg(l.cost_usd), 0)::numeric  AS avg_cost_usd
    FROM public.anthropic_call_log l
    WHERE l.created_at >= v_start
      AND l.created_at <  v_end
    GROUP BY l.app, l.fn_name
    ORDER BY total_cost_usd DESC;
END;
$$;

-- Lock down PUBLIC; grant to authenticated. The body's is_admin() check
-- makes the authenticated grant safe (non-admins get the 'admin only'
-- exception instead of data). Matches the Phase 5.8.5 REVOKE FROM PUBLIC
-- posture for SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.anthropic_spend_breakdown(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.anthropic_spend_breakdown(text, text) TO authenticated;

COMMIT;
