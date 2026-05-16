-- ============================================================================
-- Phase 5.4 feedback round (2026-05-16, post-spec-implementation).
-- ============================================================================
-- Jimmie's smoke-pass feedback on the initial 5.4 implementation:
--   - Wiki editor: switch from markdown textarea to rich-text WYSIWYG. Store
--     wiki_pages.body as HTML going forward. Convert the 11 seeded pages
--     from markdown to HTML in this migration so the new editor + renderer
--     don't see literal `**` / `#` characters.
--   - Wiki visibility: add 'admin_only' as a third option (alongside 'all'
--     and 'no_freelance'). Widen the CHECK.
--   - Vendors at a Glance -> Preferred Vendors. Update slug + title on the
--     seeded wiki_pages row.
--   - Account Logins: drop the Related column / field entirely. Remove
--     credentials.related_note.
--   - Team page -> Users page. App-side rename only (no schema impact), but
--     handle_new_user emits a notification with link_url '/team'. Repoint
--     to '/users' going forward.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop credentials.related_note.
-- ----------------------------------------------------------------------------
ALTER TABLE public.credentials DROP COLUMN IF EXISTS related_note;

-- ----------------------------------------------------------------------------
-- 2. Widen wiki_pages.visibility CHECK to include 'admin_only'.
-- ----------------------------------------------------------------------------
ALTER TABLE public.wiki_pages DROP CONSTRAINT IF EXISTS wiki_pages_visibility_check;
ALTER TABLE public.wiki_pages ADD CONSTRAINT wiki_pages_visibility_check
  CHECK (visibility IN ('all', 'no_freelance', 'admin_only'));

-- ----------------------------------------------------------------------------
-- 3. Rename Vendors at a Glance -> Preferred Vendors (slug + title).
-- ----------------------------------------------------------------------------
UPDATE public.wiki_pages
  SET slug = 'preferred-vendors', title = 'Preferred Vendors'
  WHERE slug = 'vendors-at-a-glance';

-- ----------------------------------------------------------------------------
-- 4. Convert seeded prose pages from markdown to HTML so the new TipTap-based
-- editor + HTML renderer don't show literal markdown characters. Only prose
-- pages have body content; the four special-type pages (team_directory /
-- vendors_glance / account_logins) keep body = NULL.
-- ----------------------------------------------------------------------------

UPDATE public.wiki_pages
  SET body = '<h1>Welcome to Mirror NYC</h1><p>This wiki is the team handbook. Admins can edit any page; everyone can read it. The pages on the left link to operational reference for the work we do every day.</p><p>Use it for onboarding, refresh, or just to find the right answer in one place.</p>'
  WHERE slug = 'welcome-mission';

UPDATE public.wiki_pages
  SET body = $html$<h2>Lifecycle of a Project</h2><p>Every job at Mirror moves through the same two overlapping flows. The <strong>event flow</strong> is the client-facing arc: pitch, brief, produce, deliver. The <strong>design flow</strong> is the internal arc that feeds it: kickoff, venue recon and moodboard, design rounds, client approval, production handoff.</p><p>The two are not sequential. Design rounds run while production is sourcing fabrication. The Deliverables on a Project are the dated checkpoints that come off the workback schedule, which still lives in Google Sheets.</p><h3>The standard event flow</h3><ul><li><strong>Pitch.</strong> Outlook radar item becomes a real conversation. Quote goes out.</li><li><strong>Brief.</strong> Job number assigned in the Purchase Orders Google Doc. Project created in HQ.</li><li><strong>Produce.</strong> Design rounds, vendor sourcing, fabrication, install.</li><li><strong>Deliver.</strong> Event goes live. Removal. Billing packet. Recap.</li></ul><h2>File Naming Conventions</h2><p>Every project file leads with the job number, then the client, then a short descriptor: <strong>2604_Olipop_R3-Deck</strong>. No spaces, no special characters. This keeps Drive and the server sortable in the same order.</p><h2>Server vs Google Drive</h2><p>Working files and the 7 standard subfolders live on the server (<strong>afp://files.mirrornyc.com</strong>). Client-facing decks, the brief, the budget, and the workback live in the project''s Google Drive folder. The Project record holds both the Drive URL and the Server Path so nobody has to guess.</p><h2>Slack Channel Conventions</h2><p>One channel per project, named <strong>#JOBNUMBER-client-shortname</strong>. Pin the canvas template on day one: brief link, latest deck, budget, workback. Paste the channel URL onto the Project record so HQ can deep-link to it.</p><h2>Calendar Appointment Naming</h2><p>Install, Live, and Removal blocks on the Mirror Master Calendar follow <strong>[CLIENT] Project Name · Phase</strong>. HQ pushes these automatically from Project date ranges, so the naming stays consistent without anyone hand-typing it.</p>$html$
  WHERE slug = 'how-we-work';

UPDATE public.wiki_pages
  SET body = '<h1>Key Partners</h1><p>Long-running creative + production partners the team works with most.</p><p>Fill this page in with partner bios, contact owners, contract notes, and any shared working agreements.</p>'
  WHERE slug = 'key-partners';

UPDATE public.wiki_pages
  SET body = '<h1>Forms &amp; Important Documents</h1><p>Link references for COI requests, W-9s, NDAs, tax resale certs, vendor onboarding forms, and other recurring paperwork.</p>'
  WHERE slug = 'forms-important-documents';

UPDATE public.wiki_pages
  SET body = '<h1>Pricing &amp; Markup Guide</h1><p>Internal guidance for quoting: standard markup tiers, when to discount, how to handle change orders, and the markup math the team applies on third-party costs.</p>'
  WHERE slug = 'pricing-markup-guide';

UPDATE public.wiki_pages
  SET body = '<h1>Design File Prep &amp; Specs</h1><p>Technical specs for design hand-off to fabrication: bleeds, color profiles, print-ready files, common substrate sizes, and the file-naming conventions the print partners need.</p>'
  WHERE slug = 'design-file-prep-specs';

UPDATE public.wiki_pages
  SET body = '<h1>Billing &amp; PO Workflow</h1><p>How purchase orders and invoices move at Mirror: PO creation in the master sheet, vendor invoice intake, client billing packets, and Sage timing.</p>'
  WHERE slug = 'billing-po-workflow';

UPDATE public.wiki_pages
  SET body = '<h1>Shipping &amp; Messengers</h1><p>Preferred carriers + messenger services by region, account numbers (kept in Account Logins, not duplicated here), and the SOP for international shipments.</p>'
  WHERE slug = 'shipping-messengers';

-- ----------------------------------------------------------------------------
-- 5. handle_new_user: repoint admin notification link from /team to /users.
-- Existing pre-feedback notifications still carry the old /team url; the
-- app-side adds a redirect from /team* to /users* so bookmarks stay valid.
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
  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = new_email;

  IF existing_user_id IS NOT NULL AND existing_user_id <> NEW.id THEN
    UPDATE public.users
    SET id = NEW.id,
        avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', avatar_url),
        last_active_at = now()
    WHERE id = existing_user_id;
    RETURN NEW;
  END IF;

  IF existing_user_id = NEW.id THEN
    UPDATE public.users SET last_active_at = now() WHERE id = NEW.id;
    RETURN NEW;
  END IF;

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

  INSERT INTO public.notifications (user_id, type, title, body, link_url)
  SELECT
    u.id,
    'user_pending',
    new_email || ' is awaiting tier assignment',
    'Open the Users page to assign Admin, Standard, or Freelance.',
    '/users'
  FROM public.users u
  WHERE u.permission_role = 'admin' AND u.active = true;

  PERFORM public.invoke_edge_function(
    'notify-admin-of-pending-user',
    jsonb_build_object('user_id', NEW.id, 'email', new_email)
  );

  RETURN NEW;
END;
$$;
