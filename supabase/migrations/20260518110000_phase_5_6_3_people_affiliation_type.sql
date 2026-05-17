-- Phase 5.6.3: explicit affiliation_type on people.
--
-- Pre-5.6.3, `personType()` was derived from FK presence (client_id /
-- vendor_id / venue_contact_people join). That worked until inline edit
-- on the detail page made FK clears trivial: deselecting an Organization
-- inline would flip the derived type to 'Unaffiliated' even though the
-- user just wanted to clear that specific assignment.
--
-- This migration stores the type explicitly. The FK is still the "which
-- client/vendor/venue" pointer; the type is now authoritative storage.
-- Backfill matches the prior derivation, so existing rows preserve their
-- displayed type.

BEGIN;

-- 1) Enum
CREATE TYPE public.person_affiliation_type AS ENUM (
  'Client',
  'Vendor',
  'Venue',
  'Unaffiliated'
);

-- 2) Column, NOT NULL with safe default
ALTER TABLE public.people
  ADD COLUMN affiliation_type public.person_affiliation_type
    NOT NULL DEFAULT 'Unaffiliated';

-- 3) Backfill from FK presence + venue_contact_people join, matching the
--    pre-5.6.3 personType() helper. Order is load-bearing: Client first,
--    then Vendor (mutex CHECK guarantees they're disjoint anyway), then
--    Venue for rows with a venue_contact_people row, leaving the rest at
--    the default 'Unaffiliated'.
UPDATE public.people SET affiliation_type = 'Client'  WHERE client_id IS NOT NULL;
UPDATE public.people SET affiliation_type = 'Vendor'  WHERE vendor_id IS NOT NULL;
UPDATE public.people p
   SET affiliation_type = 'Venue'
 WHERE affiliation_type = 'Unaffiliated'
   AND EXISTS (
     SELECT 1 FROM public.venue_contact_people vcp WHERE vcp.person_id = p.id
   );

-- 4) Mutex CHECK: codify what PersonEdit already enforces in app code,
--    so any future writer (Studio, SQL fixup, future feature) can't drift.
--    A Client-type person cannot have a vendor_id; a Vendor-type person
--    cannot have a client_id; Venue + Unaffiliated cannot have either FK.
ALTER TABLE public.people
  ADD CONSTRAINT people_affiliation_type_mutex_check CHECK (
    (affiliation_type = 'Client'   AND vendor_id IS NULL)
    OR (affiliation_type = 'Vendor'   AND client_id IS NULL)
    OR (
      affiliation_type IN ('Venue', 'Unaffiliated')
      AND client_id IS NULL
      AND vendor_id IS NULL
    )
  );

COMMIT;
