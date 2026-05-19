-- ============================================================================
-- Phase 5.8.5: rewrite the 4 credentials RLS policies for the auth_rls_initplan
-- optimization. Pairs with the F001 encryption migration immediately above;
-- separate file purely so the F001 schema change and the policy rewrite are
-- independent units in the migration log.
--
-- Each policy gets the inlined non-freelance predicate with `auth.uid()`
-- wrapped as `(select auth.uid())`. Behavior unchanged.
-- ============================================================================

DROP POLICY IF EXISTS credentials_select_non_freelance ON public.credentials;
CREATE POLICY credentials_select_non_freelance ON public.credentials
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (select auth.uid()) AND permission_role IN ('admin', 'standard')
  ));

DROP POLICY IF EXISTS credentials_insert_non_freelance ON public.credentials;
CREATE POLICY credentials_insert_non_freelance ON public.credentials
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (select auth.uid()) AND permission_role IN ('admin', 'standard')
  ));

DROP POLICY IF EXISTS credentials_update_non_freelance ON public.credentials;
CREATE POLICY credentials_update_non_freelance ON public.credentials
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (select auth.uid()) AND permission_role IN ('admin', 'standard')
  ));

DROP POLICY IF EXISTS credentials_delete_non_freelance ON public.credentials;
CREATE POLICY credentials_delete_non_freelance ON public.credentials
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (select auth.uid()) AND permission_role IN ('admin', 'standard')
  ));
