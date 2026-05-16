-- Phase 5.6.1: Normalize phone numbers to (XXX) XXX-XXXX where parseable.
-- Non-US, extension, or garbage values pass through unchanged.

-- Helper: extract exactly 10 digits from a string, format as (XXX) XXX-XXXX.
-- Returns the raw input unchanged if it doesn't reduce to exactly 10 digits
-- after stripping (so international numbers, extensions, and garbage survive).
CREATE OR REPLACE FUNCTION pg_temp.normalize_phone(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL OR raw = '' THEN RETURN raw; END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  -- Strip leading 1 for 11-digit US numbers.
  IF length(digits) = 11 AND left(digits, 1) = '1' THEN
    digits := substring(digits FROM 2);
  END IF;
  IF length(digits) != 10 THEN RETURN raw; END IF;
  RETURN '(' || substring(digits FROM 1 FOR 3) || ') '
      || substring(digits FROM 4 FOR 3) || '-'
      || substring(digits FROM 7 FOR 4);
END;
$$;

UPDATE people
SET phone = pg_temp.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND phone != ''
  AND phone !~ '^\(\d{3}\) \d{3}-\d{4}$';

UPDATE vendors
SET contact_phone = pg_temp.normalize_phone(contact_phone)
WHERE contact_phone IS NOT NULL
  AND contact_phone != ''
  AND contact_phone !~ '^\(\d{3}\) \d{3}-\d{4}$';

UPDATE clients
SET contact_phone = pg_temp.normalize_phone(contact_phone)
WHERE contact_phone IS NOT NULL
  AND contact_phone != ''
  AND contact_phone !~ '^\(\d{3}\) \d{3}-\d{4}$';
