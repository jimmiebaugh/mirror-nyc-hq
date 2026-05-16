-- ============================================================================
-- Phase 5.4 · Wiki + Account Logins + Team + Settings
-- ============================================================================
-- Spec: OUTPUTS/phase-5-4-spec.md (drafted 2026-05-16).
--
-- One migration, multiple steps. All changes are additive except:
--   - public.users.id loses its FK to auth.users(id) so admin pre-provisioned
--     team members can exist before they ever sign in (handle_new_user swaps
--     the id on first sign-in).
--   - public.users.department_tags (text[]) is dropped in favor of a single
--     department_id (uuid) FK into the new departments lookup. The previous
--     allowed values ('Account Manager' / 'Production' / 'Design' / 'Creative')
--     are not surfaced in any current UI; the new wireframe (Surface 12) shows
--     ONE department per person from a richer list (Leadership, Accounts,
--     Event Production, Creative, Design).
--
-- See docs/decisions.md Phase 5.4 for: id-swap pattern, page_type enum, the
-- credentials plaintext-at-rest rationale, and mirror_holidays replacing the
-- hardcoded MIRROR_HOLIDAYS constant from 5.3.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. departments lookup table
-- ----------------------------------------------------------------------------
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select_all" ON public.departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "departments_insert_admin" ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "departments_update_admin" ON public.departments
  FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "departments_delete_admin" ON public.departments
  FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;

-- Seed departments per locked Jimmie answer (2026-05-16 AskUserQuestion).
-- Phase 5.4 spec § 3 Step 1: wireframe shows ONE department per person.
INSERT INTO public.departments (name) VALUES
  ('Leadership'),
  ('Accounts'),
  ('Creative'),
  ('Design'),
  ('Event Production');

-- ----------------------------------------------------------------------------
-- 2. users table extensions
-- ----------------------------------------------------------------------------
-- Drop the FK to auth.users(id) so admin-side pre-provisioning is possible
-- (random UUID at INSERT, swapped to the auth UUID by handle_new_user on
-- first sign-in). The pkey constraint stays. Cleanup on auth.users delete
-- happens manually if ever needed; the spec accepts the trade-off.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Drop department_tags + its CHECK constraint. No surfaced UI uses it; the
-- wireframe model is a single department FK into the new lookup.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_department_tags_valid;
ALTER TABLE public.users DROP COLUMN IF EXISTS department_tags;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_title text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS slack_handle text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS slack_user_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Admin INSERT policy: required for Team page Add Team Member (pre-provisioning).
-- Existing RLS leaves INSERT denied for authenticated users (only handle_new_user
-- via SECURITY DEFINER + service_role could insert). The shipped `users_update`
-- policy already covers admin-update (`id = auth.uid() OR is_admin()`), so no
-- new UPDATE policy is needed.
CREATE POLICY "users_insert_admin" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. wiki_pages table
-- ----------------------------------------------------------------------------
CREATE TABLE public.wiki_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body text,
  page_type text NOT NULL DEFAULT 'prose'
    CHECK (page_type IN ('prose', 'team_directory', 'vendors_glance', 'account_logins')),
  visibility text NOT NULL DEFAULT 'all'
    CHECK (visibility IN ('all', 'no_freelance')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wiki_pages_sort_idx ON public.wiki_pages (sort_order ASC);

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wiki_pages_select_all" ON public.wiki_pages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "wiki_pages_insert_admin" ON public.wiki_pages
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "wiki_pages_update_admin" ON public.wiki_pages
  FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "wiki_pages_delete_admin" ON public.wiki_pages
  FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_pages TO authenticated;
GRANT ALL ON public.wiki_pages TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Seed wiki_pages: 11 pages from the wireframe nav (Surface 17), ordered
-- by sort_order. The "How We Work" body is lifted from the wireframe prose;
-- other prose pages seed with placeholder bodies that admins can replace.
-- Special pages (team_directory / vendors_glance / account_logins) have
-- NULL body — they render their own component, not markdown.
-- ----------------------------------------------------------------------------
INSERT INTO public.wiki_pages (slug, title, body, page_type, visibility, sort_order) VALUES
  ('welcome-mission', 'Welcome & Mission',
    E'# Welcome to Mirror NYC\n\nThis wiki is the team handbook. Admins can edit any page; everyone can read it. The pages on the left link to operational reference for the work we do every day.\n\nUse it for onboarding, refresh, or just to find the right answer in one place.',
    'prose', 'all', 1),
  ('team-directory', 'Team Directory', NULL, 'team_directory', 'all', 2),
  ('how-we-work', 'How We Work',
    E'## Lifecycle of a Project\n\nEvery job at Mirror moves through the same two overlapping flows. The **event flow** is the client-facing arc: pitch, brief, produce, deliver. The **design flow** is the internal arc that feeds it: kickoff, venue recon and moodboard, design rounds, client approval, production handoff.\n\nThe two are not sequential. Design rounds run while production is sourcing fabrication. The Deliverables on a Project are the dated checkpoints that come off the workback schedule, which still lives in Google Sheets.\n\n### The standard event flow\n\n- **Pitch.** Outlook radar item becomes a real conversation. Quote goes out.\n- **Brief.** Job number assigned in the Purchase Orders Google Doc. Project created in HQ.\n- **Produce.** Design rounds, vendor sourcing, fabrication, install.\n- **Deliver.** Event goes live. Removal. Billing packet. Recap.\n\n## File Naming Conventions\n\nEvery project file leads with the job number, then the client, then a short descriptor: **2604_Olipop_R3-Deck**. No spaces, no special characters. This keeps Drive and the server sortable in the same order.\n\n## Server vs Google Drive\n\nWorking files and the 7 standard subfolders live on the server (**afp://files.mirrornyc.com**). Client-facing decks, the brief, the budget, and the workback live in the project''s Google Drive folder. The Project record holds both the Drive URL and the Server Path so nobody has to guess.\n\n## Slack Channel Conventions\n\nOne channel per project, named **#JOBNUMBER-client-shortname**. Pin the canvas template on day one: brief link, latest deck, budget, workback. Paste the channel URL onto the Project record so HQ can deep-link to it.\n\n## Calendar Appointment Naming\n\nInstall, Live, and Removal blocks on the Mirror Master Calendar follow **[CLIENT] Project Name · Phase**. HQ pushes these automatically from Project date ranges, so the naming stays consistent without anyone hand-typing it.',
    'prose', 'all', 3),
  ('vendors-at-a-glance', 'Vendors at a Glance', NULL, 'vendors_glance', 'all', 4),
  ('key-partners', 'Key Partners',
    E'# Key Partners\n\nLong-running creative + production partners the team works with most.\n\nFill this page in with partner bios, contact owners, contract notes, and any shared working agreements.',
    'prose', 'all', 5),
  ('forms-important-documents', 'Forms & Important Documents',
    E'# Forms & Important Documents\n\nLink references for COI requests, W-9s, NDAs, tax resale certs, vendor onboarding forms, and other recurring paperwork.',
    'prose', 'all', 6),
  ('account-logins', 'Account Logins', NULL, 'account_logins', 'no_freelance', 7),
  ('pricing-markup-guide', 'Pricing & Markup Guide',
    E'# Pricing & Markup Guide\n\nInternal guidance for quoting: standard markup tiers, when to discount, how to handle change orders, and the markup math the team applies on third-party costs.',
    'prose', 'all', 8),
  ('design-file-prep-specs', 'Design File Prep & Specs',
    E'# Design File Prep & Specs\n\nTechnical specs for design hand-off to fabrication: bleeds, color profiles, print-ready files, common substrate sizes, and the file-naming conventions the print partners need.',
    'prose', 'all', 9),
  ('billing-po-workflow', 'Billing & PO Workflow',
    E'# Billing & PO Workflow\n\nHow purchase orders and invoices move at Mirror: PO creation in the master sheet, vendor invoice intake, client billing packets, and Sage timing.',
    'prose', 'all', 10),
  ('shipping-messengers', 'Shipping & Messengers',
    E'# Shipping & Messengers\n\nPreferred carriers + messenger services by region, account numbers (kept in Account Logins, not duplicated here), and the SOP for international shipments.',
    'prose', 'all', 11);

-- ----------------------------------------------------------------------------
-- 5. credentials table
-- ----------------------------------------------------------------------------
CREATE TABLE public.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  username text,
  password text NOT NULL,
  url text,
  related_note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

-- Freelance users blocked entirely. Standard + admin can SELECT.
CREATE POLICY "credentials_select_non_freelance" ON public.credentials
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ));
CREATE POLICY "credentials_insert_admin" ON public.credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "credentials_update_admin" ON public.credentials
  FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "credentials_delete_admin" ON public.credentials
  FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentials TO authenticated;
GRANT ALL ON public.credentials TO service_role;

-- ----------------------------------------------------------------------------
-- 6. mirror_holidays table
-- ----------------------------------------------------------------------------
CREATE TABLE public.mirror_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date date NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mirror_holidays_date_idx ON public.mirror_holidays (date ASC);

ALTER TABLE public.mirror_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mirror_holidays_select_all" ON public.mirror_holidays
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "mirror_holidays_insert_admin" ON public.mirror_holidays
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "mirror_holidays_update_admin" ON public.mirror_holidays
  FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "mirror_holidays_delete_admin" ON public.mirror_holidays
  FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mirror_holidays TO authenticated;
GRANT ALL ON public.mirror_holidays TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Seed mirror_holidays from the MIRROR_HOLIDAYS constant shipped in 5.3
-- (src/lib/calendar/holidays.ts). Values match the constant exactly so the
-- Calendar behavior on deploy is unchanged.
-- ----------------------------------------------------------------------------
INSERT INTO public.mirror_holidays (name, date) VALUES
  ('New Year''s Day', '2026-01-01'),
  ('MLK Jr. Day', '2026-01-19'),
  ('Presidents Day', '2026-02-16'),
  ('Memorial Day (observed)', '2026-05-22'),
  ('Memorial Day', '2026-05-25'),
  ('Juneteenth', '2026-06-19'),
  ('Fourth of July (observed)', '2026-07-03'),
  ('Labor Day (observed)', '2026-09-04'),
  ('Labor Day', '2026-09-07'),
  ('Thanksgiving', '2026-11-26'),
  ('Day after Thanksgiving', '2026-11-27'),
  ('Christmas / New Year''s Holiday', '2026-12-24'),
  ('Christmas / New Year''s Holiday', '2026-12-25'),
  ('Christmas / New Year''s Holiday', '2026-12-28'),
  ('Christmas / New Year''s Holiday', '2026-12-29'),
  ('Christmas / New Year''s Holiday', '2026-12-30'),
  ('Christmas / New Year''s Holiday', '2026-12-31'),
  ('Christmas / New Year''s Holiday', '2027-01-01');

-- ----------------------------------------------------------------------------
-- 8. updated_at_auto triggers
-- ----------------------------------------------------------------------------
CREATE TRIGGER set_updated_at_wiki_pages
  BEFORE UPDATE ON public.wiki_pages
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

CREATE TRIGGER set_updated_at_credentials
  BEFORE UPDATE ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

-- ----------------------------------------------------------------------------
-- 9. handle_new_user trigger amendment.
--
-- Supports pre-provisioning: if a public.users row exists with the new auth
-- user's email, swap that row's id to the auth uid (Option A in spec § 3 Step
-- 9). The placeholder UUID assigned at INSERT time has no FK references yet
-- because pre-provisioned users haven't been active, so the swap is safe.
--
-- If no pre-provisioned row exists, fall back to the existing 5.1 behavior:
-- insert as 'pending' + emit notifications + invoke notify-admin-of-pending-
-- user edge function.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_email text := NEW.email;
  existing_user_id uuid;
BEGIN
  -- 1. Pre-provisioned path: link the existing row by email.
  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = new_email;

  IF existing_user_id IS NOT NULL AND existing_user_id <> NEW.id THEN
    -- Swap the pre-provisioned row's id to match the auth uid so future
    -- auth.uid() comparisons line up. Also stamp avatar + last_active_at.
    UPDATE public.users
    SET id = NEW.id,
        avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', avatar_url),
        last_active_at = now()
    WHERE id = existing_user_id;
    RETURN NEW;
  END IF;

  IF existing_user_id = NEW.id THEN
    -- Already linked (e.g. re-trigger). Just stamp activity.
    UPDATE public.users SET last_active_at = now() WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- 2. Fresh signup path: insert as pending.
  INSERT INTO public.users (id, email, full_name, avatar_url, permission_role, active, last_active_at)
  VALUES (
    NEW.id,
    new_email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    'pending',
    true,
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Durable in-app signal: one notifications row per active admin.
  INSERT INTO public.notifications (user_id, type, title, body, link_url)
  SELECT
    u.id,
    'user_pending',
    new_email || ' is awaiting tier assignment',
    'Open the Team page to assign Admin, Standard, or Freelance.',
    '/team'
  FROM public.users u
  WHERE u.permission_role = 'admin' AND u.active = true;

  -- Out-of-band signal: admin email via the notify-admin-of-pending-user
  -- edge function. Skipped (with a WARNING) if the GUCs aren't set.
  PERFORM public.invoke_edge_function(
    'notify-admin-of-pending-user',
    jsonb_build_object('user_id', NEW.id, 'email', new_email)
  );

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. activity_log_writer triggers for the new tables. The function uses a
-- generic TG_TABLE_NAME approach (no hardcoded allowlist), so attaching the
-- trigger is sufficient.
-- ----------------------------------------------------------------------------
CREATE TRIGGER activity_log_wiki_pages
  AFTER INSERT OR UPDATE OR DELETE ON public.wiki_pages
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

CREATE TRIGGER activity_log_credentials
  AFTER INSERT OR UPDATE OR DELETE ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

CREATE TRIGGER activity_log_mirror_holidays
  AFTER INSERT OR UPDATE OR DELETE ON public.mirror_holidays
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

-- ----------------------------------------------------------------------------
-- 11. GRANT cleanup for tables Settings + Team now reach from authenticated.
--   - users INSERT: the shipped grant_data_api_access.sql GRANTed SELECT /
--     UPDATE / DELETE only (no INSERT — only handle_new_user inserts). Admin
--     pre-provisioning via the Team page now needs INSERT, gated by the new
--     users_insert_admin RLS policy above.
--   - cities DELETE / project_categories DELETE: both shipped with admin-only
--     DELETE RLS policies but the GRANT only covered SELECT/INSERT/UPDATE,
--     making the policies unreachable for authenticated. Settings page needs
--     the admin-only DELETE path reachable. Same posture fix as the Phase 5.2
--     cleanup that did this for vendor_capabilities.
-- ----------------------------------------------------------------------------
GRANT INSERT ON public.users              TO authenticated;
GRANT DELETE ON public.cities             TO authenticated;
GRANT DELETE ON public.project_categories TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. No tables added to supabase_realtime publication. Wiki / credentials /
-- holidays are low-frequency; no real-time subscription needed.
-- ----------------------------------------------------------------------------
