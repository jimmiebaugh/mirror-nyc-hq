-- Phase 5.3: outlook_entries table + outlook_confidence enum + promote_outlook_to_project RPC.
--
-- Spec: OUTPUTS/phase-5-3-spec.md § 3a + § 4b. New admin-only planning surface
-- (Surface 16) that captures speculative engagements before they convert into
-- a real Project. Confidence ladder (On Radar / Likely / Confirmed / Complete)
-- maps to amber / cyan / green / gray per locked-decisions § 4.
--
-- RLS posture: admin full CRUD; standard + freelance can SELECT only when
-- shared_with_team = true (so they can see shared entries on the unified
-- Calendar surface). Pending users blocked at the route gate; SELECT also
-- excluded because is_admin() returns false for them and shared_with_team
-- defaults false.
--
-- Realtime: not added to supabase_realtime in 5.3. Single-admin edit pattern;
-- the side panel doesn't need multi-admin live-merge. Add later if multi-
-- admin concurrent editing surfaces as a need.
--
-- promote_outlook_to_project: SECURITY DEFINER RPC that atomically INSERTs a
-- new projects row from the entry and links the entry to the new project.
-- Pre-checks is_admin() at the top so it cannot be invoked by non-admins
-- even if the gateway lets the call through.

BEGIN;

-- ============================================================================
-- 1. Enum + table
-- ============================================================================

CREATE TYPE public.outlook_confidence AS ENUM (
  'On Radar',
  'Likely',
  'Confirmed',
  'Complete'
);

CREATE TABLE public.outlook_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  -- Event name (e.g. "Office Refresh"). Not a project name; pre-conversion.

  client_id           uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  city                text,
  year                int NOT NULL,
  month               int NOT NULL CHECK (month BETWEEN 1 AND 12),
  week                int NOT NULL CHECK (week BETWEEN 1 AND 4),
  date_text           text,
  -- Freeform date string, e.g. "Early June" / "Jun 5 - 6". Pre-conversion
  -- planning surface; producers rarely have a locked date yet.

  budget              numeric,
  -- Planning estimate; NOT an invoice amount. Mirror's locked-decisions Q6
  -- keeps budget off pipeline-summary surfaces but Outlook is a planning
  -- surface so the figure is useful inline.

  confidence          public.outlook_confidence NOT NULL DEFAULT 'On Radar',
  notes               text,

  linked_project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  -- Set by promote_outlook_to_project RPC. Unlink action clears it but leaves
  -- the Project row untouched (locked-decisions § 1).

  shared_with_team    boolean NOT NULL DEFAULT false,
  -- When true, the entry surfaces as a banner on the unified Calendar for
  -- all tiers. When false, only admins see it (Outlook page is admin-only).

  created_by          uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- Explicit RESTRICT (matches the deliverables.created_by posture). NOT NULL
  -- means SET NULL would be invalid; RESTRICT is the Postgres default but
  -- spelled out for readability + to flag the rule for any future user-hard-
  -- delete cleanup work.
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outlook_entries_year_month_idx
  ON public.outlook_entries (year, month);
CREATE INDEX outlook_entries_client_idx
  ON public.outlook_entries (client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX outlook_entries_linked_project_idx
  ON public.outlook_entries (linked_project_id)
  WHERE linked_project_id IS NOT NULL;
CREATE INDEX outlook_entries_shared_idx
  ON public.outlook_entries (shared_with_team)
  WHERE shared_with_team = true;

-- ============================================================================
-- 2. Triggers (updated_at, activity_log)
-- ============================================================================

CREATE TRIGGER trg_outlook_entries_updated_at
  BEFORE UPDATE ON public.outlook_entries
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

CREATE TRIGGER trg_activity_log_outlook_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.outlook_entries
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

-- ============================================================================
-- 3. RLS + grants
-- ============================================================================

ALTER TABLE public.outlook_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY outlook_entries_select ON public.outlook_entries
  FOR SELECT TO authenticated
  USING (public.is_admin() OR shared_with_team = true);

CREATE POLICY outlook_entries_insert ON public.outlook_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY outlook_entries_update ON public.outlook_entries
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY outlook_entries_delete ON public.outlook_entries
  FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_entries TO authenticated;
GRANT ALL                            ON public.outlook_entries TO service_role;

-- ============================================================================
-- 4. promote_outlook_to_project RPC
-- ============================================================================
--
-- Atomic single-statement promotion. INSERTs a Project row from the entry's
-- fields and stamps the new project id back onto the entry's
-- linked_project_id. Returns the new project's id so the caller can navigate
-- or refresh.
--
-- SECURITY DEFINER so RLS on projects (which is open-authenticated anyway)
-- and on outlook_entries (admin-only UPDATE) doesn't gate the operation
-- mid-flight. Pre-check public.is_admin() at the top so non-admin callers
-- get a clean error rather than triggering a permission failure deeper in.

CREATE OR REPLACE FUNCTION public.promote_outlook_to_project(target_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry_row public.outlook_entries%ROWTYPE;
  new_project_id uuid;
  caller_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'promote_outlook_to_project: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO entry_row
  FROM public.outlook_entries
  WHERE id = target_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promote_outlook_to_project: entry % not found', target_entry_id
      USING ERRCODE = 'P0002';
  END IF;

  IF entry_row.linked_project_id IS NOT NULL THEN
    -- P0001 = generic raise_exception (no schema constraint backs the
    -- "already linked" rule; it's an app-level invariant enforced here).
    RAISE EXCEPTION 'promote_outlook_to_project: entry % already linked to project %',
      target_entry_id, entry_row.linked_project_id
      USING ERRCODE = 'P0001';
  END IF;

  caller_id := auth.uid();

  INSERT INTO public.projects (name, client_id, city, status, created_by)
  VALUES (
    entry_row.name,
    entry_row.client_id,
    entry_row.city,
    'Queued',
    caller_id
  )
  RETURNING id INTO new_project_id;

  UPDATE public.outlook_entries
  SET linked_project_id = new_project_id
  WHERE id = target_entry_id;

  RETURN new_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_outlook_to_project(uuid) TO authenticated;

COMMIT;
