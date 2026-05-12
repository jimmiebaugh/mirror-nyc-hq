-- Phase 4.6-port: re-introduce vs_candidate_venues_shortlist_sync trigger
-- in simplified form per port plan § 2 and docs/schema.md sync rule.
-- Fires only on shortlisted false→true (drops the failed-attempt's second
-- condition on added_manually + research_status, which don't exist in the
-- port schema).
--
-- When a candidate flips into shortlisted, try to match an existing HQ venue
-- by website_url first, then by case-insensitive name+neighborhood.
-- If matched, only sets linked_venue_id; NEVER updates the matched venue.
-- If no match, INSERTs a new HQ venue and sets linked_venue_id.
--
-- No explicit GRANT needed: the function is SECURITY DEFINER and operates on
-- public.venues + public.vs_candidate_venues, both of which had table-level
-- GRANTs to authenticated + service_role issued in Phase 3.X (venues) and
-- Phase 4.1-port (vs_candidate_venues). Trigger fires inside the existing
-- UPDATE statement RLS context, so no new GRANT is necessary.

CREATE OR REPLACE FUNCTION public.vs_candidate_venues_shortlist_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_venue_id uuid;
  scout_creator uuid;
BEGIN
  -- Only fire on shortlisted false → true.
  IF NOT (TG_OP = 'UPDATE'
          AND COALESCE(OLD.shortlisted, false) = false
          AND COALESCE(NEW.shortlisted, false) = true) THEN
    RETURN NEW;
  END IF;

  -- Already linked: nothing to do.
  IF NEW.linked_venue_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Match by website_url first (more reliable).
  IF NEW.website_url IS NOT NULL THEN
    SELECT id INTO matched_venue_id
    FROM public.venues
    WHERE website_url IS NOT NULL
      AND website_url = NEW.website_url
    LIMIT 1;
  END IF;

  -- Fallback: case-insensitive name + neighborhood match.
  IF matched_venue_id IS NULL
     AND NEW.name IS NOT NULL
     AND NEW.neighborhood IS NOT NULL THEN
    SELECT id INTO matched_venue_id
    FROM public.venues
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.name))
      AND LOWER(TRIM(COALESCE(neighborhood, ''))) = LOWER(TRIM(COALESCE(NEW.neighborhood, '')))
    LIMIT 1;
  END IF;

  -- No match: INSERT new HQ venue. Pull creator from the parent scout so
  -- the SECURITY DEFINER context still attributes ownership correctly.
  IF matched_venue_id IS NULL THEN
    SELECT created_by INTO scout_creator
    FROM public.vs_scouts
    WHERE id = NEW.scout_id;

    INSERT INTO public.venues (name, address, neighborhood, website_url, features, created_by)
    VALUES (
      NEW.name,
      NEW.address,
      NEW.neighborhood,
      NEW.website_url,
      COALESCE(NEW.key_features, '{}'),
      scout_creator
    )
    RETURNING id INTO matched_venue_id;
  END IF;

  NEW.linked_venue_id := matched_venue_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vs_candidate_venues_shortlist_sync ON public.vs_candidate_venues;

CREATE TRIGGER trg_vs_candidate_venues_shortlist_sync
  BEFORE UPDATE ON public.vs_candidate_venues
  FOR EACH ROW EXECUTE FUNCTION public.vs_candidate_venues_shortlist_sync();

COMMENT ON FUNCTION public.vs_candidate_venues_shortlist_sync IS
  'Phase 4.6-port: simplified version of the failed-attempt shortlist sync. Fires only on shortlisted false->true. Matches HQ venues by website_url first, then case-insensitive name+neighborhood. Inserts a new HQ venue row if no match. Never updates an existing HQ venue. Sets vs_candidate_venues.linked_venue_id.';
