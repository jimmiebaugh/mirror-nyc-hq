-- Phase 5.2.2.B: people table.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4f. External humans (Client / Vendor /
-- Internal partners / Venue contacts). Internal Mirror staff stay in
-- `public.users` and surface on the Team page (Surface 12, lands 5.4). Per
-- build notes Surface 11 a person can carry multiple affiliations (a
-- "Dana Whitfield" who is a Client contact + a Venue contact gets both
-- pills). `affiliations` is an enum array, GIN-indexed for the Affiliation
-- filter chip.
--
-- People rows can sit alone (no Org / no Venue) per the wireframe; the
-- organization FK is nullable. The Q8-recommended venue FK lands in the
-- 5.2.2.C migration so it can reference the venues table without ordering
-- concerns (people table created first; venue FK added after).
--
-- Recreated in Phase 5.2.1 Revision after the halted 5.2.2 worktree was
-- deleted; SQL matches what was applied to the live linked DB on
-- 2026-05-15 (registered as migration 20260515140001).

BEGIN;

CREATE TYPE public.person_affiliation AS ENUM (
  'Client',
  'Vendor',
  'Internal',
  'Venue'
);

CREATE TABLE public.people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  affiliations    public.person_affiliation[] NOT NULL DEFAULT '{}',
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  role_title      text,
  email           text,
  phone           text,
  linkedin_url    text,
  tags            text[] NOT NULL DEFAULT '{}',
  created_by      uuid NOT NULL REFERENCES public.users(id),
  -- Default ON DELETE RESTRICT: a user who authored a person cannot be
  -- hard-deleted until that person is reassigned. Matches the deliverables
  -- created_by posture from Phase 5.2.1.B.

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX people_org_idx
  ON public.people (organization_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX people_affiliation_gin_idx
  ON public.people USING gin (affiliations);
CREATE INDEX people_full_name_idx
  ON public.people (lower(full_name));

CREATE TRIGGER trg_people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

CREATE TRIGGER trg_activity_log_people
  AFTER INSERT OR UPDATE OR DELETE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

CREATE POLICY people_select ON public.people
  FOR SELECT TO authenticated USING (true);
CREATE POLICY people_insert ON public.people
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY people_update ON public.people
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY people_delete ON public.people
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;
GRANT ALL                            ON public.people TO service_role;

COMMIT;
