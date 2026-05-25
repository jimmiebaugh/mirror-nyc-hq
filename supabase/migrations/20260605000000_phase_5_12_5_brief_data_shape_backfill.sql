-- Phase 5.12.5: backfill brief_data target_audience + vibe_aesthetic to
-- array shape and reset brief_data.overview_source_hash to JSON null.
-- First BriefVenue submit post-deploy will fire one vs-generate-brief-
-- overview against the JSON-null hash (test scout has one throwaway
-- overview; accepted cost), then steady-state hash matching governs
-- all subsequent regenerates correctly.
--
-- All three keys live INSIDE brief_data (jsonb). No top-level columns
-- on vs_scouts are touched.
--
-- Idempotent: re-running is safe. Rows already in array shape stay in
-- array shape (CASE second branch); overview_source_hash is already JSON
-- null after the first run; jsonb_set writes the same value on re-apply
-- with no row-version churn.
UPDATE public.vs_scouts
SET brief_data = jsonb_set(
  jsonb_set(
    jsonb_set(
      brief_data,
      '{target_audience}',
      CASE
        WHEN jsonb_typeof(brief_data -> 'target_audience') = 'string'
             AND length(trim(brief_data ->> 'target_audience')) > 0
          THEN to_jsonb(ARRAY[trim(brief_data ->> 'target_audience')])
        WHEN jsonb_typeof(brief_data -> 'target_audience') = 'array'
          THEN brief_data -> 'target_audience'
        ELSE '[]'::jsonb
      END,
      true
    ),
    '{vibe_aesthetic}',
    CASE
      WHEN jsonb_typeof(brief_data -> 'vibe_aesthetic') = 'string'
           AND length(trim(brief_data ->> 'vibe_aesthetic')) > 0
        THEN to_jsonb(ARRAY[trim(brief_data ->> 'vibe_aesthetic')])
      WHEN jsonb_typeof(brief_data -> 'vibe_aesthetic') = 'array'
        THEN brief_data -> 'vibe_aesthetic'
      ELSE '[]'::jsonb
    END,
    true
  ),
  '{overview_source_hash}',
  'null'::jsonb,
  true
);
