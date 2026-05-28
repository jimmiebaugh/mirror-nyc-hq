-- Phase 5.15: per-tool Anthropic call-log infra.
--
-- Append-only log; one row per successful callClaude. Pre-aggregated reads
-- via public.anthropic_spend_breakdown(month_iso). Pruned to 12 months by
-- ts-cron-monthly-spend-reset.
--
-- Writes happen from the service-role wrapper (_shared/anthropic.ts); the
-- service role bypasses RLS, so there's no INSERT policy. Reads gate to
-- admins only via a single SELECT policy. The aggregation RPC is
-- SECURITY DEFINER with an inline admin gate so EXECUTE on `authenticated`
-- is safe.

BEGIN;

-- 1) Table

CREATE TABLE public.anthropic_call_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL    DEFAULT now(),
  app                 text        NOT NULL    CHECK (app IN ('talent_scout', 'venue_scout', 'hq')),
  fn_name             text        NOT NULL,
  model               text        NOT NULL,
  input_tokens        int         NOT NULL    DEFAULT 0,
  output_tokens       int         NOT NULL    DEFAULT 0,
  cache_read_tokens   int         NOT NULL    DEFAULT 0,
  cache_write_tokens  int         NOT NULL    DEFAULT 0,
  cost_usd            numeric     NOT NULL    DEFAULT 0,
  scout_id            uuid        NULL        REFERENCES public.vs_scouts(id) ON DELETE SET NULL,
  role_id             uuid        NULL        REFERENCES public.ts_roles(id)  ON DELETE SET NULL
);

COMMENT ON TABLE public.anthropic_call_log IS
  'One row per successful Anthropic API call via callClaude. Written by _shared/anthropic.ts using the service role; reads gated to admins via RLS. Pruned to 12 months by ts-cron-monthly-spend-reset. Read via public.anthropic_spend_breakdown(month_iso).';

-- 2) Indexes
--
-- Hot path: breakdown rollup -- WHERE app=? AND fn_name=? AND created_at >= ?
-- (created_at DESC also supports per-tool history scans).
CREATE INDEX idx_anthropic_call_log_app_fn_created
  ON public.anthropic_call_log (app, fn_name, created_at DESC);

-- Prune scan: WHERE created_at < ?
CREATE INDEX idx_anthropic_call_log_created
  ON public.anthropic_call_log (created_at);

-- Drilldown indexes. Partial because most rows have neither set.
CREATE INDEX idx_anthropic_call_log_scout
  ON public.anthropic_call_log (scout_id) WHERE scout_id IS NOT NULL;
CREATE INDEX idx_anthropic_call_log_role
  ON public.anthropic_call_log (role_id) WHERE role_id IS NOT NULL;

-- 3) RLS

ALTER TABLE public.anthropic_call_log ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT. Service-role writes bypass RLS, so no INSERT policy.
-- 5.16.0's `is_active_member()` pass may rewrite this; until then this
-- narrow policy is the canonical gate.
CREATE POLICY anthropic_call_log_admin_read
  ON public.anthropic_call_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.users
       WHERE id = auth.uid()
         AND permission_role = 'admin'
    )
  );

-- 4) GRANTs
--
-- SELECT to authenticated so the RLS policy can gate it; ALL to service_role
-- for the wrapper inserts (service role bypasses RLS regardless, but the
-- explicit grant matches the established lookup-table pattern).
GRANT SELECT ON public.anthropic_call_log TO authenticated;
GRANT ALL    ON public.anthropic_call_log TO service_role;

-- 5) Aggregation RPC

CREATE OR REPLACE FUNCTION public.anthropic_spend_breakdown(month_iso text DEFAULT NULL)
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
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  -- Admin gate. SECURITY DEFINER bypasses RLS, so we enforce here. Uses the
  -- canonical public.is_admin() helper (initial schema, line 244).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'anthropic_spend_breakdown: admin only';
  END IF;

  -- Default window: current calendar month UTC. month_iso accepts an ISO
  -- date or timestamp; the date_trunc('month', ...) snaps it to month start.
  IF month_iso IS NULL THEN
    v_start := date_trunc('month', now());
  ELSE
    v_start := date_trunc('month', month_iso::timestamptz);
  END IF;
  v_end := v_start + interval '1 month';

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
-- posture for new SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.anthropic_spend_breakdown(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.anthropic_spend_breakdown(text) TO authenticated;

COMMIT;
