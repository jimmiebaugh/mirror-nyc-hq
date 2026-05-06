-- ============================================================================
-- Grant Data API access to authenticated + service_role
-- ============================================================================
-- The Supabase project has "Auto-expose new tables" OFF, so tables created via
-- migration receive no default privileges. Without explicit GRANTs, signed-in
-- API queries hit `42501 permission denied`. RLS still gates rows; these
-- GRANTs only make the tables reachable from the Data API at all.
--
-- Per the auth model in CLAUDE.md:
--   - authenticated: full DML on application tables; restricted on a few
--     where INSERT/DELETE must go through SECURITY DEFINER triggers or the
--     service role.
--   - service_role: ALL on every table (bypasses RLS at the role layer).
--   - anon: nothing on application tables. Pre-sign-in clients get rejected
--     until they swap to a JWT.
--
-- Future migrations that create tables MUST add their own GRANTs in the same
-- file. Auto-expose stays off as the security default.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Standard HQ + scout tables: full DML for authenticated, ALL for service.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.clients,
  public.projects,
  public.project_account_managers,
  public.project_designers,
  public.venues,
  public.venue_types,
  public.project_venues,
  public.tasks,
  public.ts_roles,
  public.ts_pull_rounds,
  public.ts_candidates,
  public.ts_candidate_attachments,
  public.ts_final_reviews,
  public.vs_scouts,
  public.vs_briefs,
  public.vs_sourcing_rounds,
  public.vs_candidate_venues,
  public.vs_pitch_decks
TO authenticated;

GRANT ALL ON
  public.clients,
  public.projects,
  public.project_account_managers,
  public.project_designers,
  public.venues,
  public.venue_types,
  public.project_venues,
  public.tasks,
  public.ts_roles,
  public.ts_pull_rounds,
  public.ts_candidates,
  public.ts_candidate_attachments,
  public.ts_final_reviews,
  public.vs_scouts,
  public.vs_briefs,
  public.vs_sourcing_rounds,
  public.vs_candidate_venues,
  public.vs_pitch_decks
TO service_role;

-- ----------------------------------------------------------------------------
-- users: no INSERT for authenticated (only handle_new_user trigger inserts).
-- ----------------------------------------------------------------------------
GRANT SELECT, UPDATE, DELETE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;

-- ----------------------------------------------------------------------------
-- notifications: no INSERT for authenticated (service role + edge functions).
-- ----------------------------------------------------------------------------
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- ----------------------------------------------------------------------------
-- global_settings: SELECT for any auth user, UPDATE gated by RLS to admin.
-- Never INSERT (single seeded row) and never DELETE.
-- ----------------------------------------------------------------------------
GRANT SELECT, UPDATE ON public.global_settings TO authenticated;
GRANT ALL ON public.global_settings TO service_role;

-- ----------------------------------------------------------------------------
-- activity_log: SELECT for any auth user. Writes only via the SECURITY
-- DEFINER trigger (which runs as table owner and bypasses these grants).
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

-- ----------------------------------------------------------------------------
-- Helper functions used by RLS policies need EXECUTE for the calling role.
-- SECURITY DEFINER means the function bodies run as postgres regardless;
-- EXECUTE only controls who can INVOKE them.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.is_admin(),
  public.is_producer_or_admin(),
  public.current_user_role()
TO authenticated, service_role;
