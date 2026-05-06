# Mirror NYC HQ Project Plan

## What this is

You're working with Jimmie Baugh, Senior Producer at Mirror NYC, an experiential events agency in NYC. He's building "Mirror NYC HQ", an internal web app that replaces the team's scattered Google Sheets and Drive folders with a relational, Notion-style central database, plus two embedded modules (Talent Scout, Venue Scout) for hiring and venue-sourcing workflows.

Jimmie is not a developer. Light HTML/CSS, fluent designing AI workflows, comfortable in Lovable. His goal is for you to do the heavy backend lifting while he uses Lovable for net-new UI scaffolding only.

## How to talk to Jimmie

- Casual, direct, friend-who-knows-this-stuff tone
- No em dashes anywhere
- No filler affirmations ("Great question!", "Absolutely!", etc.)
- Concise by default; go deeper when the task calls for it
- Recommend, don't just present options. Give your read with the tradeoff stated plainly
- Reference only the latest version of anything he's submitted; if something changed, the old version is gone
- Don't fill in gaps. If something is unclear or missing, ask him

## Stack

- Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui, scaffolded by Lovable
- Backend: Supabase (Postgres, Auth, Edge Functions, Realtime, Storage)
- Hosting: Netlify (auto-deploy from GitHub on push to main, preview URLs per branch)
- Repo: GitHub `mirror-nyc-hq` (private)
- AI: Anthropic API (Talent Scout evaluations, Venue Scout research)
- Google APIs: Gmail, Slides, Drive via a single service account with domain-wide delegation

## Architecture

Monolith. Mirror NYC HQ is the single app. Talent Scout and Venue Scout are routes inside it (`/talent-scout`, `/venue-scout`), sharing one database, auth, and design system.

## Supabase project

- URL: `https://amipjjmphblfxpghjnel.supabase.co`
- Project ref ID: `amipjjmphblfxpghjnel`
- Publishable key (client-side): set as `VITE_SUPABASE_PUBLISHABLE_KEY`
- Secret/service role key (server-side, edge functions only): stored as Supabase secret
- DB password: in Jimmie's password manager
- Security settings: Data API enabled, Auto-expose new tables OFF, Auto-RLS ON

## Schema

All timestamp columns use `timestamptz` (timezone-aware). Date-only columns use `date`.

### HQ Core

#### users (synced from auth.users via auth-on-signup)
- `id` (uuid, PK, FK to `auth.users.id`)
- `email` (text, unique, not null)
- `full_name` (text)
- `avatar_url` (text)
- `permission_role` (enum: `member`, `producer`, `admin`; default `member`)
- `department_tags` (text[]; allowed values: 'Account Manager', 'Production', 'Design', 'Creative'; users self-tag)
- `active` (bool, default true; soft-delete column)
- `created_at`, `updated_at`

#### clients
- `id` (uuid, PK)
- `name` (text, not null)
- `contact_name`, `contact_email`, `contact_phone` (text)
- `notes` (text)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`

#### projects
- `id` (uuid, PK)
- `name` (text, not null)
- `client_id` (uuid, FK to clients, nullable)
- `status` (enum, refined later: Quoting, Quote Sent, On Hold, Awaiting FB, Awaiting Files, Awaiting Approval, In Progress, Complete, In Production, Event Live, Billing, Proof Out, Location Scouting, In Review)
- `live_dates_start`, `live_dates_end` (date, nullable)
- `production_folder_url`, `design_decks_folder_url`, `budget_sheet_url`, `latest_creative_deck_url`, `slack_channel_url` (text, all nullable)
- `notes` (text)
- `archived_at` (timestamp, nullable; null = active, non-null = archived; default queries filter `archived_at IS NULL`)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`

#### project_account_managers (join, every project must have at least one row)
- `project_id`, `user_id` (PK composite)

#### project_designers (join, optional)
- `project_id`, `user_id` (PK composite)

#### project_venues (join, multi-venue per project)
- `project_id`, `venue_id` (PK composite)
- The Notion-style backlist on a Venue page queries this to show every project that's used or is using the venue.

#### venues
- `id` (uuid, PK)
- `name` (text, not null), `address`, `neighborhood` (text)
- `venue_type_id` (uuid, FK to venue_types, nullable)
- `capacity`, `square_footage` (int)
- `website_url`, `contact_name`, `contact_email`, `contact_phone` (text)
- `features` (text[])
- `notes` (text)
- `photos` (text[]; Supabase Storage paths)
- `created_by` (uuid, FK)
- `created_at`, `updated_at`

#### venue_types (lookup; Jimmie will provide values)
- `id` (uuid, PK), `name` (text, unique, not null), `created_at`

#### tasks
- `id` (uuid, PK)
- `title` (text, not null), `description` (text)
- `project_id` (uuid, FK, nullable for personal tasks)
- `assignee_id` (uuid, FK to users, nullable)
- `created_by` (uuid, FK to users, not null)
- `status` (enum: `todo`, `in_progress`, `blocked`, `done`)
- `due_date` (date, nullable)
- `created_at`, `updated_at`, `completed_at`

### Talent Scout (siloed from HQ)

Source of truth for the user-facing flow is Jimmie's screen-by-screen spec, which he can paste again if you need it.

#### ts_roles
- `id`, `title`, `location`, `type`, `compensation`, `start_date`, `job_description`, `hiring_priorities`
- `hiring_manager_id` (FK to users; must be admin, enforced in app)
- `scorecard` (jsonb: array of `{criterion, tier, weight, max_points}`)
- `evaluation_prompt` (text, editable per role)
- `competitor_bonus` (jsonb: `{competitors: [], bonus_points: 0}`)
- `email_keywords` (text[]), `email_search_start_date` (date)
- `auto_pull_schedule` (enum: `off`, `daily`, `every_3_days`, `weekly`)
- `auto_rejection_threshold` (int)
- `status` (enum: `open`, `closed`), `closed_at` (timestamp)
- `created_by` (FK), `created_at`, `updated_at`
- Daily cron purges where `closed_at` > 60 days ago, cascading.

#### ts_pull_rounds
- `id`, `role_id` (FK)
- `pulled_from`, `pulled_to` (timestamp; may be incremental)
- `status` (enum: `running`, `complete`, `failed`, `stalled`)
- `triggered_by` (enum: `manual`, `scheduled`)
- `started_at`, `completed_at`, `created_by` (FK)

#### ts_candidates
- `id`, `pull_round_id` (FK), `role_id` (FK; denormalized)
- `name`, `email` (text), `applied_date` (date), `gmail_message_id` (text)
- `score` (numeric)
- `status` (enum: `consider`, `promote`, `reject`, `fast_track`, `auto_rejected`)
- `recruiter_overview` (text)
- `top_strengths`, `key_gaps`, `quick_overview` (jsonb arrays)
- `score_breakdown` (jsonb)
- `tier` (text), `internal_notes` (text)
- `portfolio_type` (enum: `file`, `url`, `none`), `portfolio_path_or_url` (text)
- `last_evaluated_at`, `created_at`, `updated_at`

#### ts_candidate_attachments
- `id`, `candidate_id` (FK)
- `attachment_type` (enum: `resume`, `cover_letter`, `portfolio`, `email_pdf`, `other`)
- `file_name`, `file_path` (text), `file_size_bytes` (int), `created_at`
- Daily cron: purge files for closed-role candidates > 90 days, rejected-candidate files > 30 days.

#### ts_final_reviews
- `id`, `role_id` (FK), `candidate_count_limit` (int, nullable)
- `pool_summary` (text)
- `final_rankings` (jsonb: `[{candidate_id, final_tier, rationale}]`)
- `triggered_by` (FK), `generated_at`

### Venue Scout (linked to HQ)

#### vs_scouts
- `id`, `name` (text)
- `project_id` (FK to projects, nullable; standalone allowed)
- `phase` (enum: `sourcing`, `deck`, `done`)
- `created_by`, `created_at`, `updated_at`, `last_touched_at`

#### vs_briefs (multiple briefs allowed per scout)
- `id`, `scout_id` (FK)
- `source_file_path` (text)
- `client`, `event_name`, `vibe`, `target_audience`, `ideal_features` (text)
- `event_dates_start`, `event_dates_end` (date), `budget` (text)
- `neighborhoods` (text[])
- `square_footage_min`, `square_footage_max` (int)
- `event_overview` (text, editable, used for deck)
- `created_at`, `updated_at`

#### vs_sourcing_rounds
- `id`, `scout_id` (FK)
- `source_type` (enum: `uploaded_sheet`, `ai_research`)
- `uploaded_file_path` (nullable)
- `status` (enum: `researching`, `complete`, `failed`)
- `generated_at`

#### vs_candidate_venues
- `id`, `sourcing_round_id` (FK), `scout_id` (FK; denormalized)
- `linked_venue_id` (FK to venues, nullable; populated when synced)
- `name`, `address`, `neighborhood`, `venue_type` (text; freeform here)
- `features` (text[]), `alignment_criteria` (jsonb)
- `rank` (int 0-100)
- `recommendations`, `considerations`, `notes`, `pitch_notes`, `website_url` (text)
- `shortlisted` (bool), `pitched` (bool), `include_in_deck` (bool, default true)
- `order_in_deck` (int)
- `photos` (jsonb: `{top_left, top_right, bottom_left, bottom_right}`)
- `added_manually` (bool)
- `created_at`, `updated_at`

Sync rule: when `shortlisted` flips false to true, OR when an `added_manually` venue's research completes, check HQ `venues` for a match (by `name + neighborhood` or by `website_url`). If no match, INSERT a new row in `venues` and set `linked_venue_id`. If match, just set `linked_venue_id`. Never update an existing HQ venue row.

#### vs_pitch_decks
- `id`, `scout_id` (FK)
- `google_slides_id`, `google_slides_url`, `drive_folder_path` (text)
- `version_number` (int; incremented per regeneration)
- `generated_at`, `generated_by` (FK)

### Cross-cutting

#### notifications
- `id`, `user_id` (FK; recipient)
- `type` (text: `task_assigned`, `task_due`, `project_updated`, `pull_complete`, `final_review_ready`, etc.)
- `title`, `body`, `link_url` (text)
- `read` (bool), `delivered_in_app` (bool), `delivered_email` (bool)
- `created_at`, `read_at`

#### global_settings (single row)
- `id` (uuid, PK)
- `anthropic_spend_cap_monthly_usd`, `anthropic_spend_current_month_usd` (numeric)
- `default_drive_folder_for_standalone_vs_decks` (text)
- `venue_research_priority_sites` (text[]; admin-configurable, NOT a hard restriction)
- `talent_scout_packet_default_count` (int, default 15)
- `email_notifications_enabled`, `in_app_notifications_enabled` (bool)
- `updated_at`

#### activity_log
- `id`, `entity_type` (text: `project`, `venue`, `task`, etc.)
- `entity_id` (uuid)
- `action` (text: `created`, `updated`, `status_changed`, `assigned`)
- `actor_id` (FK to users)
- `payload` (jsonb)
- `created_at`

## Postgres triggers

- `vs_candidate_venues_shortlist_sync`: implements the sync rule above.
- `tasks_completed_at_set`: when status flips to `done`, set `completed_at = now()`.
- `activity_log_writer`: on insert/update/status-change to projects, venues, tasks, write an activity_log row.
- `updated_at_auto`: standard, on every table with `updated_at`.

## Auth model

### Permission roles (3 tiers, stacked)

- `member`: full read/write on HQ tables. No Venue Scout, no Talent Scout, no global settings. Default for new signups.
- `producer`: everything member can do, plus full read/write on Venue Scout.
- `admin`: everything producer can do, plus Talent Scout, user role management, global settings.

### Per-project assignments (separate from permission role)

- account_managers (1+, required) on every project. Any user can be assigned regardless of permission role.
- designers (0+, optional). Same.

### Identity

- Google OAuth via Supabase Auth, restricted to `@mirrornyc.com`.
- Three reinforcing layers: `hd=mirrornyc.com` OAuth parameter, Supabase allowed domains, app-level email check.

### RLS

- `users`: SELECT any auth user. INSERT blocked from API (only via auth-on-signup with service role). UPDATE: own row for `avatar_url`, `full_name`, `department_tags`; admin can update anyone's `permission_role`. DELETE admin only.
- HQ tables (projects, clients, venues, venue_types, tasks, all join tables): SELECT/INSERT/UPDATE any auth user. DELETE: admin only for projects, venues, clients. Tasks: any auth user can DELETE.
- ts_*: all operations admin only.
- vs_*: SELECT/INSERT/UPDATE producer or admin. DELETE admin only.
- notifications: SELECT and UPDATE only by recipient. INSERT via service role only.
- global_settings: SELECT any auth user. UPDATE admin only.
- activity_log: SELECT any auth user. INSERT via Postgres trigger only.

### Storage buckets

- `candidate_attachments`: admin only
- `briefs`, `sourcing_sheets`: producer or admin
- `venue_photos`: any auth read; producer or admin write
- `profile_avatars`: any auth read; user writes only to their own folder

### Service account

Single Google service account with domain-wide delegation, owned by Mirror NYC's Workspace, scopes:
- `gmail.readonly` (Talent Scout candidate ingestion)
- `gmail.send` (all outbound email from jobs@mirrornyc.com)
- `presentations` (Slides deck generation)
- `drive` (Drive saves and template reads)

JSON key stored as a Supabase secret. Used by edge functions only.

## Edge functions

### Talent Scout
- `ts-pull-candidates(role_id, triggered_by)`: Gmail search, attachment download, PDF text extraction, link parsing, portfolio detection, Anthropic scoring.
- `ts-evaluate-candidate(candidate_id)`: single-candidate eval/re-eval.
- `ts-bulk-reevaluate(role_id)`: re-eval the master pool.
- `ts-final-review(role_id, candidate_count_limit?)`: comparative final review.
- `ts-packet-generate(role_id, pull_round_id?, candidate_count?)`: build packet PDF and email to hiring manager.

### Venue Scout
- `vs-parse-brief(file_path)`: parse uploaded brief.
- `vs-research-venues(scout_id)`: AI + web research using `global_settings.venue_research_priority_sites` as soft context.
- `vs-parse-sourcing-sheet(file_path, scout_id)`: parse PDF/XLSX/CSV.
- `vs-research-single-venue(candidate_venue_id)`: research a manual venue, triggers HQ Venues backfill.
- `vs-generate-deck(scout_id)`: copy Slides template, populate, save to project's Drive folder or default folder.

### Cross-cutting
- `notifications-dispatch(event_type, entity_id, recipient_user_ids)`: insert notifications + send email via Gmail API service account.
- `auth-on-signup(user_id)`: create public.users row with `permission_role = 'member'`.
- `anthropic-spend-tracker` (helper): wraps every Anthropic call, tracks spend, refuses calls if cap is hit (refuse + email admin, do NOT pause new pulls).

## Cron jobs (pg_cron)

- `ts-cron-scheduled-pulls` (daily 8am ET): fires ts-pull-candidates for due roles.
- `ts-cron-pull-watchdog` (every 10 min): recovers stalled pull rounds.
- `ts-cron-reeval-watchdog` (every 10 min): recovers stalled re-evals.
- `ts-cron-storage-cleanup` (daily 9am UTC): purges old attachments + deletes ts_roles closed > 60 days ago.

## Current state

Phase 1 (Foundation):
- 1.1 Supabase project: DONE.
- 1.2 Google Cloud Console user-facing OAuth client: DONE (Internal type). Service account: NOT created yet.
- 1.3 Service account domain-wide delegation: NOT done. Requires Mirror NYC Workspace admin.
- 1.4 GitHub repo: DONE.
- 1.5 Netlify imported repo: DONE.
- 1.6 Local toolchain: Git DONE; Supabase CLI status TBD; psql status TBD; Node assumed DONE.

Phase 2 (Schema and auth):
- 2.1 Lovable project, Supabase connector, GitHub connector, Google OAuth, sign-in tested: DONE. Jimmie's account confirmed in `auth.users`.
- 2.2 Schema migration: DONE. All 22 tables, enums, helper + trigger functions, RLS policies, and 5 storage buckets applied via `supabase/migrations/20260506061457_initial_schema.sql`.
- 2.3 Seed Jimmie as admin: DONE. `public.users` row inserted manually with `permission_role = 'admin'`.
- 2.4 Sanity test: NOT done. **You're picking up here.**

## Picking up at Phase 2.4

### Phase 2.4: Sanity test

Note: Lovable's initial scaffold may have wired the projects-list query to read a plain `client` text field. The real schema uses `client_id` FK to clients. Fix this wiring as part of the sanity test, either via a follow-up Lovable prompt or directly in code.

1. Jimmie signs in to the Lovable preview.
2. /projects route should load against real schema. Fix any wiring mismatches (especially `client` vs `client_id`).
3. Insert a test project via UI or psql; verify it lands.
4. Try an RLS violation (e.g., update another user's permission_role from a non-admin session); should fail.

## Beyond Phase 2

Phase 3 (Talent Scout) goes BEFORE Phase 4 (Venue Scout). Sequential, not parallel. Talent Scout fully working before Venue Scout starts.

- Phase 3 (Talent Scout port): use Jimmie's cloned `mirror-talent-scout` repo as reference. Bring UI components, Anthropic eval logic, Gmail integration over to `/talent-scout` route. Set up edge functions and crons.
- Phase 4 (Venue Scout): same approach. Venue Scout draft repo is incomplete; the screen-by-screen spec (Jimmie has this; can paste on request) is the source of truth, not the draft.
- Phase 5 (Cross-cutting): notifications, activity log feed, admin pages, polish.
- Phase 6 (Cutover):
  - 6.1 Final QA pass against the full spec, every flow as each role.
  - 6.2 Talent Scout data preservation. Approach: re-create active/open roles in new HQ (re-pulling candidates from Gmail reproduces the structured data). Manually copy bucket decisions and internal notes for in-flight candidates. Export packet PDFs from Lovable for closed roles, preserve as historical archive in HQ file storage. No full structured migration needed.
  - 6.3 Production deploy on Netlify. Launch on `mirror-nyc-hq.netlify.app` default URL. Hook up `hq.mirrornyc.com` once Mirror NYC Workspace admin grants the subdomain.
  - 6.4 Onboard team. Send link, verify accounts created with member role, promote producers and admins via admin UI.
  - 6.5 Sunset Lovable. Shut down all three Lovable projects, cancel subscription, archive credentials.

## Open questions still pending

- venue_types lookup values. Jimmie will provide before Venue Scout build (Phase 4).
- Project status enum values may be refined and reduced later. Current 14 values are fine for now.
- Talent Scout data extraction details (Phase 6.2). Plan is to re-create active roles via Gmail re-pull and preserve closed roles as packet PDFs. If Phase 6 inventory turns up data that doesn't fit this pattern, revisit then.

## Notes

- Jimmie's Talent Scout repo is cloned locally; reference at Phase 3.
- Venue Scout draft is in his Lovable account; clone when needed for Phase 4.
- HQ Lovable draft was discarded; we started fresh in Phase 2.1.
- Jimmie's git commit email: `jimmie@jimmiebaugh.com`. His Mirror NYC email is the auth identity.
- Working pattern: Jimmie drafts Claude Code prompts with his Cowork session (separate chat). Update this doc when phases complete: summarize finished phases to one line, add detailed steps for the next immediate phase.