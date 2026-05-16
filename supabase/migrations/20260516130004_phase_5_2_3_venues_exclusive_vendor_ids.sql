-- Phase 5.2.3.E: venues column rename + defensive cleanup.
--
-- Spec: OUTPUTS/phase-5-2-3-spec.md § 3.E. The shipped column name
-- `exclusive_vendors_org_ids` is misleading after the organizations ->
-- vendors rename. Single column rename; element values still resolve
-- because vendor IDs were preserved by the table rename in 5.2.3.B.
--
-- Defensive cleanup: any element values that were Client IDs (now gone
-- from organizations / vendors) get stripped from the array. The 5.2.2
-- seed didn't include any Client IDs in this column, so this is a safety
-- net for hand-edited dev data only.
--
-- Depends on 5.2.3.B (vendor IDs must be queryable from `vendors`).

BEGIN;

ALTER TABLE public.venues
  RENAME COLUMN exclusive_vendors_org_ids TO exclusive_vendor_ids;

UPDATE public.venues
   SET exclusive_vendor_ids = COALESCE(
     (SELECT array_agg(v_id)
        FROM unnest(exclusive_vendor_ids) AS v_id
       WHERE v_id IN (SELECT id FROM public.vendors)),
     '{}'::uuid[]
   )
 WHERE exclusive_vendor_ids IS NOT NULL
   AND array_length(exclusive_vendor_ids, 1) > 0;

COMMIT;
