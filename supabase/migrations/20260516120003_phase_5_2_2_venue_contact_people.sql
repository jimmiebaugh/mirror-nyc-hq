-- Phase 5.2.2.H: venue_contact_people join table.
--
-- Spec: OUTPUTS/phase-5-2-2-spec.md § 3d + § 12 Q1 (locked join-table
-- approach). One person can contact many venues; one venue can have many
-- contact people. Composite PK + ON DELETE CASCADE on both sides means
-- removing a venue or a person sweeps the join rows without leaving
-- orphans. Insert-or-delete only; no UPDATE policy because the row has no
-- mutable user fields beyond created_at.

BEGIN;

CREATE TABLE public.venue_contact_people (
  venue_id   uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, person_id)
);

CREATE INDEX venue_contact_people_person_idx
  ON public.venue_contact_people (person_id);
CREATE INDEX venue_contact_people_venue_idx
  ON public.venue_contact_people (venue_id);

ALTER TABLE public.venue_contact_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_contact_people_select ON public.venue_contact_people
  FOR SELECT TO authenticated USING (true);
CREATE POLICY venue_contact_people_insert ON public.venue_contact_people
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY venue_contact_people_delete ON public.venue_contact_people
  FOR DELETE TO authenticated USING (true);
-- No UPDATE policy: rows are insert-or-delete only.

GRANT SELECT, INSERT, DELETE ON public.venue_contact_people TO authenticated;
GRANT ALL                    ON public.venue_contact_people TO service_role;

COMMIT;
