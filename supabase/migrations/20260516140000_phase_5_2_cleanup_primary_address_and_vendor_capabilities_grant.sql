-- Phase 5.2 cleanup: vendors.primary_address column + vendor_capabilities GRANT fix.
-- Spec: /Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/phase-5-2-cleanup-spec.md § 3.A.
--
-- Two additive changes bundled into one migration; both items follow
-- the 5.2.3 carry-forward inventory:
--
-- Item E: vendors.primary_address column lifted from the ClientEdit shape.
--   Spec § 4.B.3 of phase-5-2-3-spec.md implicitly listed Primary Address
--   in the Vendor Edit Primary Contact card by analogy from Client Edit,
--   but the shipped vendors schema didn't carry the column. Added here
--   nullable (existing rows get NULL) so VendorEdit's new Primary Address
--   textarea + VendorDetail's new Primary Address kv row both have a
--   place to read from / write to.
--
-- Item B: vendor_capabilities GRANT missing DELETE. The admin-only DELETE
--   RLS policy on vendor_capabilities exists from the org_capabilities ->
--   vendor_capabilities rename in 5.2.3.A but the table-level GRANT to
--   `authenticated` only covers SELECT / INSERT / UPDATE. Without DELETE
--   in the GRANT, the policy is unreachable (PG checks GRANT first, then
--   RLS). Bring posture in line with the clients / cities /
--   project_categories / vendor_categories tables which all carry the
--   admin-only DELETE policy reachable via a full GRANT.

BEGIN;

-- Item E: add primary_address to vendors (matches clients shape).
ALTER TABLE public.vendors
  ADD COLUMN primary_address text;

-- Item B: vendor_capabilities GRANT missing DELETE.
GRANT DELETE ON public.vendor_capabilities TO authenticated;

COMMIT;
