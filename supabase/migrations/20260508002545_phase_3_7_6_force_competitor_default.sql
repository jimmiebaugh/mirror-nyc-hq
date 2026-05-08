-- Phase 3.7.6.7: ensure global_settings has the canonical competitor list.
--
-- Earlier migration (20260507225501) used `WHERE talent_scout_competitor_list = '{}'`
-- which silently no-ops if the row doesn't exist or had any prior value. This
-- migration is idempotent and unconditional:
--   1. Ensure the global_settings row exists.
--   2. If the column is empty, populate with the canonical list. Existing
--      non-empty lists are preserved.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.global_settings) THEN
    INSERT INTO public.global_settings (talent_scout_competitor_list) VALUES (ARRAY[
      'Another A Story',
      'CNC Agency',
      'Momentum Worldwide',
      'MKG',
      'Invisible North',
      'MATTE Projects',
      'Arsenal NY',
      'David Stark Design',
      'Perron Roettinger',
      'NVE Experience Agency',
      'Villa Eugenie',
      'Prodject',
      'The Concierge Club',
      'Stoelt Productions',
      'Salt Productions',
      'Gradient',
      'Pinch Creative',
      'MAG Experiential',
      'AgenC'
    ]);
  ELSE
    UPDATE public.global_settings
    SET talent_scout_competitor_list = ARRAY[
      'Another A Story',
      'CNC Agency',
      'Momentum Worldwide',
      'MKG',
      'Invisible North',
      'MATTE Projects',
      'Arsenal NY',
      'David Stark Design',
      'Perron Roettinger',
      'NVE Experience Agency',
      'Villa Eugenie',
      'Prodject',
      'The Concierge Club',
      'Stoelt Productions',
      'Salt Productions',
      'Gradient',
      'Pinch Creative',
      'MAG Experiential',
      'AgenC'
    ]
    WHERE talent_scout_competitor_list IS NULL
       OR cardinality(talent_scout_competitor_list) = 0;
  END IF;
END$$;
