-- Phase 3.7.5: global Talent Scout competitor list.
--
-- Source repo had this column on global_settings; HQ never ported it. New
-- roles should be seeded with this default list so hiring managers don't
-- have to retype it for every role. Per Jimmie: changes here only affect
-- FUTURE roles; existing roles keep whatever's on ts_roles.competitor_bonus.
--
-- Stored as text[] (Postgres array) — matches source's shape and is
-- simpler than a jsonb { competitors: [...] } since there are no other
-- fields needed at the global level. Per-role version stays as
-- ts_roles.competitor_bonus = { competitors, bonus_points } jsonb because
-- the bonus_points scalar lives there too.

ALTER TABLE public.global_settings
  ADD COLUMN talent_scout_competitor_list text[] NOT NULL DEFAULT '{}';
