-- Phase 3.7.6.1: seed the default global Talent Scout competitor list.
--
-- Per Jimmie: this is the canonical Mirror NYC competitor list.
-- Existing roles are NOT touched — they keep whatever's saved on
-- ts_roles.competitor_bonus.competitors. Only seeds the global default
-- if it's currently empty (so we don't clobber a list a user has
-- already curated through the new Settings page).

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
WHERE talent_scout_competitor_list = '{}' OR talent_scout_competitor_list IS NULL;
