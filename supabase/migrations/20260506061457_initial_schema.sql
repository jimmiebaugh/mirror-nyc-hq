-- ============================================================================
-- Mirror NYC HQ: initial schema
-- ============================================================================
-- Applies in this order:
--   1. Enums
--   2. Helper functions (role checks, updated_at, etc.)
--   3. Trigger functions (auth sync, status timestamps, sync rules, activity log)
--   4. Tables (HQ core, then Talent Scout, then Venue Scout, then cross-cutting)
--   5. Indexes
--   6. Triggers
--   7. RLS enable + policies on every table
--   8. Storage buckets + storage RLS policies
--   9. Seed rows (single global_settings row)
-- ============================================================================

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

CREATE TYPE public.permission_role AS ENUM ('member', 'producer', 'admin');

CREATE TYPE public.project_status AS ENUM (
  'Quoting',
  'Quote Sent',
  'On Hold',
  'Awaiting FB',
  'Awaiting Files',
  'Awaiting Approval',
  'In Progress',
  'Complete',
  'In Production',
  'Event Live',
  'Billing',
  'Proof Out',
  'Location Scouting',
  'In Review'
);

CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'blocked', 'done');

CREATE TYPE public.ts_role_status AS ENUM ('open', 'closed');
CREATE TYPE public.ts_role_auto_pull_schedule AS ENUM ('off', 'daily', 'every_3_days', 'weekly');
CREATE TYPE public.ts_pull_round_status AS ENUM ('running', 'complete', 'failed', 'stalled');
CREATE TYPE public.ts_pull_round_triggered_by AS ENUM ('manual', 'scheduled');
CREATE TYPE public.ts_candidate_status AS ENUM ('consider', 'promote', 'reject', 'fast_track', 'auto_rejected');
CREATE TYPE public.ts_candidate_portfolio_type AS ENUM ('file', 'url', 'none');
CREATE TYPE public.ts_candidate_attachment_type AS ENUM ('resume', 'cover_letter', 'portfolio', 'email_pdf', 'other');

CREATE TYPE public.vs_scout_phase AS ENUM ('sourcing', 'deck', 'done');
CREATE TYPE public.vs_sourcing_round_source_type AS ENUM ('uploaded_sheet', 'ai_research');
CREATE TYPE public.vs_sourcing_round_status AS ENUM ('researching', 'complete', 'failed');
CREATE TYPE public.vs_research_status AS ENUM ('pending', 'researching', 'complete', 'failed');

-- ============================================================================
-- 2. HELPER FUNCTIONS (table-independent)
-- ============================================================================
-- The role-check helpers (is_admin etc.) reference public.users and so are
-- defined in section 4.5 after the users table exists. SQL-language functions
-- are parsed eagerly at CREATE time, unlike plpgsql which defers.

-- Generic updated_at toucher.
CREATE OR REPLACE FUNCTION public.updated_at_auto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. TRIGGER FUNCTIONS (defined now; attached after their tables exist)
-- ============================================================================
-- All plpgsql, so name resolution defers until first execution. Safe to define
-- before referenced tables exist.

-- auth.users -> public.users sync. Fires on new auth signup.
-- New signups always start as 'member'; admins promote later via UI / admin RPC.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, permission_role, active)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    'member',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Defense-in-depth: prevent non-admins from changing permission_role or active.
-- RLS allows users to update their own row, but row-level policies can't gate columns.
CREATE OR REPLACE FUNCTION public.users_protect_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.permission_role IS DISTINCT FROM NEW.permission_role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change permission_role';
  END IF;
  IF OLD.active IS DISTINCT FROM NEW.active AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change active status';
  END IF;
  RETURN NEW;
END;
$$;

-- tasks: status -> done sets completed_at; status -> anything else clears it.
CREATE OR REPLACE FUNCTION public.tasks_completed_at_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'done' THEN
    NEW.completed_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'done' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ts_roles: status -> closed sets closed_at; status -> open clears it.
-- The 60-day purge cron depends on closed_at being correct.
CREATE OR REPLACE FUNCTION public.ts_roles_closed_at_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'closed' THEN
    NEW.closed_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'closed' THEN
      NEW.closed_at := now();
    ELSIF NEW.status = 'open' THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- vs_candidate_venues -> venues sync.
-- Fires when (a) shortlisted flips false->true OR (b) added_manually=true row's
-- research_status flips to 'complete'. Tries to match an existing HQ venue by
-- website_url first, then by case-insensitive name+neighborhood. If matched,
-- only sets linked_venue_id; never updates the matched venue. If no match,
-- inserts a new HQ venue and sets linked_venue_id.
CREATE OR REPLACE FUNCTION public.vs_candidate_venues_shortlist_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_venue_id uuid;
  should_sync boolean := false;
  scout_creator uuid;
BEGIN
  -- Condition 1: shortlisted false -> true
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.shortlisted, false) = false
     AND COALESCE(NEW.shortlisted, false) = true THEN
    should_sync := true;
  END IF;

  -- Condition 2: added_manually row's research_status -> complete
  IF TG_OP = 'UPDATE'
     AND OLD.research_status IS DISTINCT FROM NEW.research_status
     AND NEW.research_status = 'complete'
     AND COALESCE(NEW.added_manually, false) = true THEN
    should_sync := true;
  END IF;

  IF NOT should_sync THEN
    RETURN NEW;
  END IF;

  -- Already linked: nothing to do.
  IF NEW.linked_venue_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Match by website_url first (more reliable), then by name + neighborhood.
  SELECT id INTO matched_venue_id
  FROM public.venues
  WHERE NEW.website_url IS NOT NULL
    AND website_url IS NOT NULL
    AND website_url = NEW.website_url
  LIMIT 1;

  IF matched_venue_id IS NULL THEN
    SELECT id INTO matched_venue_id
    FROM public.venues
    WHERE lower(name) = lower(NEW.name)
      AND lower(coalesce(neighborhood, '')) = lower(coalesce(NEW.neighborhood, ''))
    LIMIT 1;
  END IF;

  IF matched_venue_id IS NULL THEN
    -- No match: insert a new HQ venue, attribute to the scout's creator.
    SELECT created_by INTO scout_creator FROM public.vs_scouts WHERE id = NEW.scout_id;

    INSERT INTO public.venues (name, address, neighborhood, features, website_url, notes, created_by)
    VALUES (
      NEW.name,
      NEW.address,
      NEW.neighborhood,
      COALESCE(NEW.features, '{}'::text[]),
      NEW.website_url,
      NEW.notes,
      scout_creator
    )
    RETURNING id INTO matched_venue_id;
  END IF;

  NEW.linked_venue_id := matched_venue_id;
  RETURN NEW;
END;
$$;

-- Activity log writer. Fires on projects, venues, tasks for INSERT/UPDATE.
-- SECURITY DEFINER so it can write to activity_log even though that table has
-- no INSERT policy for authenticated users.
CREATE OR REPLACE FUNCTION public.activity_log_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_val text;
  payload_val jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_val := 'created';
    payload_val := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect status changes for projects and tasks.
    IF (TG_TABLE_NAME IN ('projects', 'tasks'))
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      action_val := 'status_changed';
      payload_val := jsonb_build_object('from', OLD.status, 'to', NEW.status);
    -- Detect archive transitions on projects.
    ELSIF TG_TABLE_NAME = 'projects'
          AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
      action_val := CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END;
      payload_val := jsonb_build_object('archived_at', NEW.archived_at);
    ELSE
      action_val := 'updated';
      payload_val := jsonb_build_object('id', NEW.id);
    END IF;
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), action_val, auth.uid(), payload_val);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- 4. TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- HQ Core
-- ----------------------------------------------------------------------------

-- Mirror of auth.users with app-level fields (role, department tags, etc.).
-- Populated by the on_auth_user_created trigger. INSERTs from the API are
-- blocked by RLS; only the SECURITY DEFINER trigger and service role can write.
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  permission_role public.permission_role NOT NULL DEFAULT 'member',
  department_tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_department_tags_valid CHECK (
    department_tags <@ ARRAY['Account Manager', 'Production', 'Design', 'Creative']::text[]
  )
);

-- TODO (app-level): every project must have at least one row in
-- project_account_managers. If a user is hard-deleted and is the sole AM on a
-- project, the project ends up with zero AMs. Block (or warn on) hard-delete
-- of users who are sole AMs anywhere; can't enforce cleanly at the DB level.

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status public.project_status NOT NULL DEFAULT 'Quoting',
  live_dates_start date,
  live_dates_end date,
  production_folder_url text,
  design_decks_folder_url text,
  budget_sheet_url text,
  latest_creative_deck_url text,
  slack_channel_url text,
  notes text,
  -- archived_at: null = active, non-null = archived. App default queries
  -- everywhere should filter `archived_at IS NULL`.
  archived_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_account_managers (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.project_designers (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE public.venue_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  neighborhood text,
  venue_type_id uuid REFERENCES public.venue_types(id) ON DELETE SET NULL,
  capacity integer,
  square_footage integer,
  website_url text,
  contact_name text,
  contact_email text,
  contact_phone text,
  features text[] NOT NULL DEFAULT '{}',
  notes text,
  photos text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_venues (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, venue_id)
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  status public.task_status NOT NULL DEFAULT 'todo',
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ----------------------------------------------------------------------------
-- Talent Scout (siloed; admin-only)
-- ----------------------------------------------------------------------------

CREATE TABLE public.ts_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  location text,
  type text,
  compensation text,
  start_date date,
  job_description text,
  hiring_priorities text,
  -- App-level enforcement: hiring_manager_id must reference a user with
  -- permission_role = 'admin'. Not a DB constraint because role can change.
  hiring_manager_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scorecard jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluation_prompt text,
  competitor_bonus jsonb NOT NULL DEFAULT '{"competitors": [], "bonus_points": 0}'::jsonb,
  email_keywords text[] NOT NULL DEFAULT '{}',
  email_search_start_date date,
  auto_pull_schedule public.ts_role_auto_pull_schedule NOT NULL DEFAULT 'off',
  auto_rejection_threshold integer,
  status public.ts_role_status NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ts_pull_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.ts_roles(id) ON DELETE CASCADE,
  pulled_from timestamptz,
  pulled_to timestamptz,
  status public.ts_pull_round_status NOT NULL DEFAULT 'running',
  triggered_by public.ts_pull_round_triggered_by NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE public.ts_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_round_id uuid NOT NULL REFERENCES public.ts_pull_rounds(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.ts_roles(id) ON DELETE CASCADE,
  name text,
  email text,
  applied_date date,
  gmail_message_id text,
  score numeric,
  status public.ts_candidate_status NOT NULL DEFAULT 'consider',
  recruiter_overview text,
  top_strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  quick_overview jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier text,
  internal_notes text,
  portfolio_type public.ts_candidate_portfolio_type NOT NULL DEFAULT 'none',
  portfolio_path_or_url text,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ts_candidate_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.ts_candidates(id) ON DELETE CASCADE,
  attachment_type public.ts_candidate_attachment_type NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ts_final_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.ts_roles(id) ON DELETE CASCADE,
  candidate_count_limit integer,
  pool_summary text,
  final_rankings jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Venue Scout
-- ----------------------------------------------------------------------------

CREATE TABLE public.vs_scouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  phase public.vs_scout_phase NOT NULL DEFAULT 'sourcing',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_touched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vs_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id uuid NOT NULL REFERENCES public.vs_scouts(id) ON DELETE CASCADE,
  source_file_path text,
  client text,
  event_name text,
  vibe text,
  target_audience text,
  ideal_features text,
  event_dates_start date,
  event_dates_end date,
  budget text,
  neighborhoods text[] NOT NULL DEFAULT '{}',
  square_footage_min integer,
  square_footage_max integer,
  event_overview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vs_sourcing_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id uuid NOT NULL REFERENCES public.vs_scouts(id) ON DELETE CASCADE,
  source_type public.vs_sourcing_round_source_type NOT NULL,
  uploaded_file_path text,
  status public.vs_sourcing_round_status NOT NULL DEFAULT 'researching',
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vs_candidate_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_round_id uuid NOT NULL REFERENCES public.vs_sourcing_rounds(id) ON DELETE CASCADE,
  scout_id uuid NOT NULL REFERENCES public.vs_scouts(id) ON DELETE CASCADE,
  linked_venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  name text NOT NULL,
  address text,
  neighborhood text,
  venue_type text,
  features text[] NOT NULL DEFAULT '{}',
  alignment_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  rank integer CHECK (rank IS NULL OR (rank >= 0 AND rank <= 100)),
  recommendations text,
  considerations text,
  notes text,
  pitch_notes text,
  website_url text,
  shortlisted boolean NOT NULL DEFAULT false,
  pitched boolean NOT NULL DEFAULT false,
  include_in_deck boolean NOT NULL DEFAULT true,
  order_in_deck integer,
  photos jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_manually boolean NOT NULL DEFAULT false,
  -- Drives the shortlist sync trigger (along with shortlisted). AI-sourced
  -- venues are inserted as 'complete'; manually-added venues start 'pending'
  -- and flip through 'researching' to 'complete' (or 'failed') via
  -- vs-research-single-venue.
  research_status public.vs_research_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vs_pitch_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id uuid NOT NULL REFERENCES public.vs_scouts(id) ON DELETE CASCADE,
  google_slides_id text,
  google_slides_url text,
  drive_folder_path text,
  version_number integer NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Cross-cutting
-- ----------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link_url text,
  read boolean NOT NULL DEFAULT false,
  delivered_in_app boolean NOT NULL DEFAULT false,
  delivered_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE TABLE public.global_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anthropic_spend_cap_monthly_usd numeric NOT NULL DEFAULT 0,
  anthropic_spend_current_month_usd numeric NOT NULL DEFAULT 0,
  default_drive_folder_for_standalone_vs_decks text,
  venue_research_priority_sites text[] NOT NULL DEFAULT '{}',
  talent_scout_packet_default_count integer NOT NULL DEFAULT 15,
  email_notifications_enabled boolean NOT NULL DEFAULT true,
  in_app_notifications_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4.5 ROLE-CHECK HELPER FUNCTIONS (defined now that public.users exists)
-- ============================================================================
-- Kept as LANGUAGE sql + STABLE so the planner can inline them into RLS
-- policy expressions, which keeps per-row policy checks cheap.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.permission_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT permission_role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT permission_role = 'admin' FROM public.users WHERE id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.is_producer_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT permission_role IN ('producer', 'admin') FROM public.users WHERE id = auth.uid()), false);
$$;

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

CREATE INDEX idx_projects_client_id ON public.projects(client_id);
CREATE INDEX idx_projects_archived_at ON public.projects(archived_at);
CREATE INDEX idx_projects_status ON public.projects(status);

CREATE INDEX idx_venues_neighborhood ON public.venues(neighborhood);
CREATE INDEX idx_venues_venue_type_id ON public.venues(venue_type_id);

CREATE INDEX idx_tasks_project_id ON public.tasks(project_id);
CREATE INDEX idx_tasks_assignee_id ON public.tasks(assignee_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);

CREATE INDEX idx_ts_pull_rounds_role_id ON public.ts_pull_rounds(role_id);
CREATE INDEX idx_ts_pull_rounds_status ON public.ts_pull_rounds(status);
CREATE INDEX idx_ts_candidates_role_id ON public.ts_candidates(role_id);
CREATE INDEX idx_ts_candidates_pull_round_id ON public.ts_candidates(pull_round_id);
CREATE INDEX idx_ts_candidates_status ON public.ts_candidates(status);
CREATE INDEX idx_ts_candidates_score ON public.ts_candidates(score);
CREATE INDEX idx_ts_candidate_attachments_candidate_id ON public.ts_candidate_attachments(candidate_id);
CREATE INDEX idx_ts_final_reviews_role_id ON public.ts_final_reviews(role_id);
CREATE INDEX idx_ts_roles_status ON public.ts_roles(status);
CREATE INDEX idx_ts_roles_closed_at ON public.ts_roles(closed_at);

CREATE INDEX idx_vs_scouts_project_id ON public.vs_scouts(project_id);
CREATE INDEX idx_vs_scouts_phase ON public.vs_scouts(phase);
CREATE INDEX idx_vs_briefs_scout_id ON public.vs_briefs(scout_id);
CREATE INDEX idx_vs_sourcing_rounds_scout_id ON public.vs_sourcing_rounds(scout_id);
CREATE INDEX idx_vs_candidate_venues_scout_id ON public.vs_candidate_venues(scout_id);
CREATE INDEX idx_vs_candidate_venues_sourcing_round_id ON public.vs_candidate_venues(sourcing_round_id);
CREATE INDEX idx_vs_candidate_venues_linked_venue_id ON public.vs_candidate_venues(linked_venue_id);
CREATE INDEX idx_vs_pitch_decks_scout_id ON public.vs_pitch_decks(scout_id);

CREATE INDEX idx_notifications_user_id_read ON public.notifications(user_id, read);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);

CREATE INDEX idx_activity_log_entity ON public.activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_log_actor_id ON public.activity_log(actor_id);
CREATE INDEX idx_activity_log_created_at ON public.activity_log(created_at DESC);

-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- updated_at autotouch on every table that has the column.
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_ts_roles_updated_at BEFORE UPDATE ON public.ts_roles
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_ts_candidates_updated_at BEFORE UPDATE ON public.ts_candidates
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_vs_scouts_updated_at BEFORE UPDATE ON public.vs_scouts
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_vs_briefs_updated_at BEFORE UPDATE ON public.vs_briefs
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_vs_candidate_venues_updated_at BEFORE UPDATE ON public.vs_candidate_venues
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_global_settings_updated_at BEFORE UPDATE ON public.global_settings
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

-- auth.users -> public.users sync.
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Defense-in-depth column gate on users.
CREATE TRIGGER trg_users_protect_admin_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_protect_admin_columns();

-- Status -> timestamp triggers.
CREATE TRIGGER trg_tasks_completed_at BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_completed_at_set();
CREATE TRIGGER trg_ts_roles_closed_at BEFORE INSERT OR UPDATE ON public.ts_roles
  FOR EACH ROW EXECUTE FUNCTION public.ts_roles_closed_at_set();

-- Venue Scout shortlist sync.
CREATE TRIGGER trg_vs_candidate_venues_sync
  BEFORE UPDATE ON public.vs_candidate_venues
  FOR EACH ROW EXECUTE FUNCTION public.vs_candidate_venues_shortlist_sync();

-- Activity log writers.
CREATE TRIGGER trg_activity_log_projects
  AFTER INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();
CREATE TRIGGER trg_activity_log_venues
  AFTER INSERT OR UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();
CREATE TRIGGER trg_activity_log_tasks
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

-- ============================================================================
-- 7. RLS ENABLE + POLICIES
-- ============================================================================
-- Auto-RLS is on at the project level; the explicit ALTER TABLE statements are
-- belt-and-suspenders so this migration is self-contained.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_account_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_designers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_pull_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_candidate_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_final_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_sourcing_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_candidate_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_pitch_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- users: SELECT any auth user; UPDATE own row OR admin updates anyone (column
-- gate trigger blocks non-admin permission_role/active changes); DELETE admin
-- only; INSERT blocked from API (only via SECURITY DEFINER trigger / service).
-- ----------------------------------------------------------------------------
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- HQ tables: any auth user reads/writes. DELETE admin only for projects,
-- venues, clients. Tasks: any auth user can DELETE.
-- ----------------------------------------------------------------------------
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY venues_select ON public.venues FOR SELECT TO authenticated USING (true);
CREATE POLICY venues_insert ON public.venues FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY venues_update ON public.venues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY venues_delete ON public.venues FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY venue_types_select ON public.venue_types FOR SELECT TO authenticated USING (true);
CREATE POLICY venue_types_insert ON public.venue_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY venue_types_update ON public.venue_types FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY venue_types_delete ON public.venue_types FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated USING (true);

-- Join tables: any auth user reads/writes.
CREATE POLICY pam_select ON public.project_account_managers FOR SELECT TO authenticated USING (true);
CREATE POLICY pam_insert ON public.project_account_managers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pam_update ON public.project_account_managers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pam_delete ON public.project_account_managers FOR DELETE TO authenticated USING (true);

CREATE POLICY pd_select ON public.project_designers FOR SELECT TO authenticated USING (true);
CREATE POLICY pd_insert ON public.project_designers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pd_update ON public.project_designers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pd_delete ON public.project_designers FOR DELETE TO authenticated USING (true);

CREATE POLICY pv_select ON public.project_venues FOR SELECT TO authenticated USING (true);
CREATE POLICY pv_insert ON public.project_venues FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pv_update ON public.project_venues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pv_delete ON public.project_venues FOR DELETE TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- Talent Scout: all operations admin only.
-- ----------------------------------------------------------------------------
CREATE POLICY ts_roles_all ON public.ts_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ts_pull_rounds_all ON public.ts_pull_rounds FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ts_candidates_all ON public.ts_candidates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ts_candidate_attachments_all ON public.ts_candidate_attachments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ts_final_reviews_all ON public.ts_final_reviews FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- Venue Scout: SELECT/INSERT/UPDATE producer or admin. DELETE admin only.
-- ----------------------------------------------------------------------------
CREATE POLICY vs_scouts_select ON public.vs_scouts FOR SELECT TO authenticated USING (public.is_producer_or_admin());
CREATE POLICY vs_scouts_insert ON public.vs_scouts FOR INSERT TO authenticated WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_scouts_update ON public.vs_scouts FOR UPDATE TO authenticated USING (public.is_producer_or_admin()) WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_scouts_delete ON public.vs_scouts FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY vs_briefs_select ON public.vs_briefs FOR SELECT TO authenticated USING (public.is_producer_or_admin());
CREATE POLICY vs_briefs_insert ON public.vs_briefs FOR INSERT TO authenticated WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_briefs_update ON public.vs_briefs FOR UPDATE TO authenticated USING (public.is_producer_or_admin()) WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_briefs_delete ON public.vs_briefs FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY vs_sourcing_rounds_select ON public.vs_sourcing_rounds FOR SELECT TO authenticated USING (public.is_producer_or_admin());
CREATE POLICY vs_sourcing_rounds_insert ON public.vs_sourcing_rounds FOR INSERT TO authenticated WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_sourcing_rounds_update ON public.vs_sourcing_rounds FOR UPDATE TO authenticated USING (public.is_producer_or_admin()) WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_sourcing_rounds_delete ON public.vs_sourcing_rounds FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY vs_candidate_venues_select ON public.vs_candidate_venues FOR SELECT TO authenticated USING (public.is_producer_or_admin());
CREATE POLICY vs_candidate_venues_insert ON public.vs_candidate_venues FOR INSERT TO authenticated WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_candidate_venues_update ON public.vs_candidate_venues FOR UPDATE TO authenticated USING (public.is_producer_or_admin()) WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_candidate_venues_delete ON public.vs_candidate_venues FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY vs_pitch_decks_select ON public.vs_pitch_decks FOR SELECT TO authenticated USING (public.is_producer_or_admin());
CREATE POLICY vs_pitch_decks_insert ON public.vs_pitch_decks FOR INSERT TO authenticated WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_pitch_decks_update ON public.vs_pitch_decks FOR UPDATE TO authenticated USING (public.is_producer_or_admin()) WITH CHECK (public.is_producer_or_admin());
CREATE POLICY vs_pitch_decks_delete ON public.vs_pitch_decks FOR DELETE TO authenticated USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- notifications: recipient-only SELECT and UPDATE. INSERT via service role.
-- ----------------------------------------------------------------------------
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- global_settings: SELECT any auth user, UPDATE admin only.
-- INSERT/DELETE via service role only (single row, seeded below).
-- ----------------------------------------------------------------------------
CREATE POLICY global_settings_select ON public.global_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY global_settings_update ON public.global_settings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- activity_log: SELECT any auth user. INSERT only via SECURITY DEFINER trigger.
-- ----------------------------------------------------------------------------
CREATE POLICY activity_log_select ON public.activity_log FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 8. STORAGE BUCKETS + POLICIES
-- ============================================================================

INSERT INTO storage.buckets (id, name, public) VALUES
  ('candidate_attachments', 'candidate_attachments', false),
  ('briefs', 'briefs', false),
  ('sourcing_sheets', 'sourcing_sheets', false),
  ('venue_photos', 'venue_photos', true),
  ('profile_avatars', 'profile_avatars', true)
ON CONFLICT (id) DO NOTHING;

-- candidate_attachments: admin only.
CREATE POLICY storage_candidate_attachments_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'candidate_attachments' AND public.is_admin())
  WITH CHECK (bucket_id = 'candidate_attachments' AND public.is_admin());

-- briefs: producer or admin.
CREATE POLICY storage_briefs_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'briefs' AND public.is_producer_or_admin())
  WITH CHECK (bucket_id = 'briefs' AND public.is_producer_or_admin());

-- sourcing_sheets: producer or admin.
CREATE POLICY storage_sourcing_sheets_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'sourcing_sheets' AND public.is_producer_or_admin())
  WITH CHECK (bucket_id = 'sourcing_sheets' AND public.is_producer_or_admin());

-- venue_photos: public bucket. Reads via direct CDN URLs bypass RLS.
-- For SDK list/select, allow public SELECT. Writes/deletes producer or admin.
CREATE POLICY storage_venue_photos_select ON storage.objects FOR SELECT
  USING (bucket_id = 'venue_photos');
CREATE POLICY storage_venue_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'venue_photos' AND public.is_producer_or_admin());
CREATE POLICY storage_venue_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'venue_photos' AND public.is_producer_or_admin())
  WITH CHECK (bucket_id = 'venue_photos' AND public.is_producer_or_admin());
CREATE POLICY storage_venue_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'venue_photos' AND public.is_producer_or_admin());

-- profile_avatars: public bucket. Users write only to their own folder
-- (folder name = user id, e.g. profile_avatars/<uid>/avatar.png).
CREATE POLICY storage_profile_avatars_select ON storage.objects FOR SELECT
  USING (bucket_id = 'profile_avatars');
CREATE POLICY storage_profile_avatars_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_profile_avatars_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY storage_profile_avatars_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- 9. SEED ROWS
-- ============================================================================

-- Single global_settings row. Future updates only; never insert another.
INSERT INTO public.global_settings DEFAULT VALUES;
