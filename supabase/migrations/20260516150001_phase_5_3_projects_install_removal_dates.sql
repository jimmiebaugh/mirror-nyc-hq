-- Phase 5.3: projects install + removal date columns.
--
-- Spec: OUTPUTS/phase-5-3-spec.md § 3b. Existing live_dates_start / _end
-- captured the show-dates only; the Calendar wants Install + Removal as
-- separate event ranges, and the Projects Timeline view has bar slots
-- spec'd for Install + Live + Removal that until now had no data source.
--
-- Pure additive. All nullable, no constraints, no backfill. Producers fill
-- in the dates via the ProjectEdit form as the data becomes known.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN install_dates_start date,
  ADD COLUMN install_dates_end   date,
  ADD COLUMN removal_dates_start date,
  ADD COLUMN removal_dates_end   date;

COMMIT;
