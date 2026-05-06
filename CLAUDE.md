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
- `reeval_status` (enum: `idle`, `running`, `complete`, `failed`), `reeval_status_filter` (text)
- `reeval_total`, `reeval_processed`, `reeval_failed` (int): per-run counters for `ts-bulk-reevaluate`.
- `reeval_started_at`, `reeval_completed_at`, `reeval_last_progress_at` (timestamptz): bulk re-eval timestamps; `reeval_last_progress_at` is the heartbeat the re-eval watchdog (Phase 3.7) reads to detect stalled runs.
- `created_by` (FK), `created_at`, `updated_at`
- Daily cron purges where `closed_at` > 60 days ago, cascading.

#### ts_pull_rounds
- `id`, `role_id` (FK)
- `pulled_from`, `pulled_to` (timestamp; may be incremental)
- `status` (enum: `running`, `complete`, `failed`, `stalled`)
- `triggered_by` (enum: `manual`, `scheduled`)
- `started_at`, `completed_at`, `created_by` (FK)
- `round_number` (int): `R1`, `R2`, ... per role. Set at insert time as `max(round_number) + 1` for the role.
- `candidates_found`, `processed_count`, `attempt` (int): operational counters used by progress UI and watchdog.
- `pending_candidates` (jsonb, default `[]`): queue of Gmail message IDs the chunked pull pipeline batches in groups of 8 across self-invocations.
- `reeval_last_progress_at` (timestamptz, nullable): legacy column from Phase 3.2 spec. Phase 3.5 moved bulk-re-eval state to `ts_roles` (role-scoped, not round-scoped); this column is unused and can be dropped in a future cleanup migration.

#### ts_evaluations (per-evaluation history)
- `id` (uuid, PK)
- `role_id` (FK to ts_roles), `candidate_id` (FK to ts_candidates)
- `scorecard_snapshot` (jsonb, not null): role.scorecard at evaluation time.
- `eval_prompt_snapshot` (text, not null): role.evaluation_prompt at evaluation time.
- `score` (numeric), `score_breakdown` (jsonb)
- `recruiter_overview` (text), `top_strengths` (jsonb), `key_gaps` (jsonb)
- `tier` (text), `internal_notes_at_time` (text)
- `evaluated_at` (timestamptz), `triggered_by` (FK to users)
- Index on `(candidate_id, evaluated_at DESC)` for the candidate-detail timeline.
- **History table.** New row per evaluation (INSERT, never UPSERT). The latest fields are mirrored onto `ts_candidates` for fast list queries; older rows preserve scoring history for audit. Bulk re-eval (which implies the prompt or scorecard changed) is the one exception: it deletes prior rows for the candidate before inserting via the `overwrite_history: true` flag on `ts-evaluate-candidate`.

#### ts_candidates
- `id`, `pull_round_id` (FK), `role_id` (FK; denormalized)
- `name`, `email` (text), `applied_date` (date), `gmail_message_id` (text)
- `location` (text, nullable): extracted by Claude from candidate materials and persisted on initial pull / re-eval.
- `score` (numeric)
- `status` (enum: `consider`, `interview`, `reject`, `fast_track`, `auto_rejected`). `interview` was renamed from the original spec's `promote` in Phase 3.5 (concrete next-stage action). `auto_rejected` is AI-only; admins can pick the four manual ones via `StatusDropdown` or the bulk action bar.
- `recruiter_overview` (text)
- `top_strengths`, `key_gaps`, `quick_overview` (jsonb arrays)
- `score_breakdown` (jsonb): `{criterion_name: int}`. Sum of values + competitor bonus = total score on this row.
- `tier` (text), `internal_notes` (text)
- `portfolio_type` (enum: `file`, `url`, `none`), `portfolio_path_or_url` (text)
- `detected_links` (jsonb, default `[]`): array of `{url, type}` for every URL extracted from the email body + attachments + bare-domain mentions, classified into `vimeo_reel | drive_folder | portfolio_site | other`. Surfaced in CandidateDetail's Files & Materials section. The single best one is also picked into `portfolio_type` / `portfolio_path_or_url`.
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
- `cap_alert_sent_this_month` (bool, default false): paired with `anthropic_spend_current_month_usd` so the spend tracker emails the admin once per cap crossing instead of every API call after the cap is hit.
- `default_drive_folder_for_standalone_vs_decks` (text)
- `venue_research_priority_sites` (text[]; admin-configurable, NOT a hard restriction)
- `talent_scout_packet_default_count` (int, default 15)
- `email_notifications_enabled`, `in_app_notifications_enabled` (bool)
- `updated_at`

A monthly cron (planned, not yet implemented) resets `anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false at the start of each calendar month.

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

### Edge Function self-invocation auth

Some Edge Functions (`ts-pull-candidates` so far; the re-eval and packet-generate functions in 3.5/3.6 will join) self-invoke for chunked processing. The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch — applies to whatever key Supabase ships in `SUPABASE_SERVICE_ROLE_KEY` for newer projects). To unblock self-invocation:

1. **Per-function `verify_jwt = false`** in `supabase/config.toml`, e.g.:
   ```toml
   [functions.ts-pull-candidates]
   verify_jwt = false
   ```
   This disables gateway JWT verification for that function only. Other functions stay on the default `verify_jwt = true`.

2. **`INTERNAL_API_SECRET`** is set as a Supabase secret (random 256-bit hex). Self-invocations send it as the `x-internal-secret` header.

3. **Auth enforcement moves into the function** via `supabase/functions/_shared/internalAuth.ts`'s `requireInternalOrUserAuth(req)`. It returns null (allow) for any of:
   - `x-internal-secret` matches `INTERNAL_API_SECRET` (self-invocation, cron callers)
   - Authorization bearer matches `SUPABASE_SERVICE_ROLE_KEY` exactly (direct service-role calls)
   - Authorization bearer is a valid user JWT (frontend `supabase.functions.invoke` from signed-in admin)

   Anything else → 401. Anon callers that slip past the disabled gateway are rejected here.

**When to use this pattern:** any Edge Function that POSTs back to itself (chunked pipelines, batch processing). Use the default `verify_jwt = true` for one-shot user-invoked functions like `ts-generate-scorecard` — they don't need the override.

## Edge functions

### Talent Scout
- `ts-pull-candidates(role_id, triggered_by)`: Gmail search, attachment download, PDF text extraction, link parsing, portfolio detection, Anthropic scoring. Chunked self-invoking pipeline (BATCH_SIZE=8) using `ts_pull_rounds.pending_candidates`.
- `ts-evaluate-candidate(candidate_id)`: single-candidate eval/re-eval. Inserts a row into `ts_evaluations` and mirrors the result onto `ts_candidates`.
- `ts-bulk-reevaluate(role_id)`: re-eval the master pool. Updates `ts_pull_rounds.reeval_last_progress_at` as a heartbeat.
- `ts-generate-scorecard(title, job_description, hiring_priorities)`: drafts a tiered scorecard via Claude; the new-role wizard's step-3 page calls this.
- `ts-final-review(role_id, candidate_count_limit?)`: comparative final review.
- `ts-packet-generate(role_id, pull_round_id?, candidate_count?)`: build packet PDF and email to hiring manager.
- `ts-send-pull-notification(role_id, pull_round_id)`: emails the hiring manager when a pull completes. Standalone in Phase 3.8 to ship Talent Scout cleanly; folds into `notifications-dispatch` in Phase 5.

### Venue Scout
- `vs-parse-brief(file_path)`: parse uploaded brief.
- `vs-research-venues(scout_id)`: AI + web research using `global_settings.venue_research_priority_sites` as soft context.
- `vs-parse-sourcing-sheet(file_path, scout_id)`: parse PDF/XLSX/CSV.
- `vs-research-single-venue(candidate_venue_id)`: research a manual venue, triggers HQ Venues backfill.
- `vs-generate-deck(scout_id)`: copy Slides template, populate, save to project's Drive folder or default folder.

### Cross-cutting
- `notifications-dispatch(event_type, entity_id, recipient_user_ids)`: insert notifications + send email via Gmail API service account.
- `auth-on-signup(user_id)`: create public.users row with `permission_role = 'member'`.
- `_shared/anthropic.ts` exports `callClaude(app, messages, options)` where `app` is `'talent_scout' | 'venue_scout' | 'hq'` and selects the per-app secret (`ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ`). Wraps the raw fetch to `api.anthropic.com`, computes cost from the response usage block (incl. cache-read/write discounts), increments `global_settings.anthropic_spend_current_month_usd`, and emails the admin once per cap crossing (gated by `cap_alert_sent_this_month`). Does NOT refuse calls when over cap — graceful degradation, not a hard failure.

## Cron jobs (pg_cron)

- `ts-cron-scheduled-pulls` (daily 8am ET): fires ts-pull-candidates for due roles.
- `ts-cron-pull-watchdog` (every 10 min): recovers stalled pull rounds.
- `ts-cron-reeval-watchdog` (every 10 min): recovers stalled re-evals.
- `ts-cron-storage-cleanup` (daily 9am UTC): purges old attachments + deletes ts_roles closed > 60 days ago.

## Current state

Phase 1 (Foundation):
- 1.1 Supabase project: DONE.
- 1.2 Google Cloud Console user-facing OAuth client + service account: DONE. Service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com`. JSON key lives outside git in `secrets/` (gitignored).
- 1.3 Service account domain-wide delegation: DONE. All four scopes (`gmail.readonly`, `gmail.send`, `drive`, `presentations`) granted and verified via `scripts/verify-service-account.ts`. Script does a per-scope JWT bearer flow, smoke-tests `messages.list` and `files.list` for the read scopes, and reports any failure with the exact scope string to add in Admin Console.
- 1.4 GitHub repo: DONE.
- 1.5 Netlify imported repo: DONE.
- 1.6 Local toolchain: Git, Supabase CLI 2.98.1, psql 18.3, Node 25.9.0 all DONE.

Phase 2 (Schema and auth):
- 2.1 Lovable project, Supabase connector, GitHub connector, Google OAuth, sign-in tested: DONE. Jimmie's account confirmed in `auth.users`.
- 2.2 Schema migration: DONE. All 22 tables, enums, helper + trigger functions, RLS policies, and 5 storage buckets applied via `supabase/migrations/20260506061457_initial_schema.sql`.
- 2.3 Seed Jimmie as admin: DONE. `public.users` row inserted manually with `permission_role = 'admin'`.
- 2.4 Sanity test: DONE. Fixed `/projects` query to match new schema (`client_id` + clients join, `live_dates_*`, `archived_at IS NULL` filter), regenerated typed Supabase client, granted Data API access to authenticated/service_role (`supabase/migrations/20260506065157_grant_data_api_access.sql`), confirmed sign-in lands on local dashboard and projects list renders. Cross-user RLS violation test deferred to Phase 6.4 when a second team account is available.

Phase 3 (Talent Scout port):
- 3.1 Inventory + port plan: DONE. See `docs/talent-scout-port-plan.md` for the full breakdown of what lifts/adapts/rewrites/drops, schema diff, and the section-9 sub-phase sequence that drives 3.2 through 3.8.
- 3.2 Schema augmentation, edge function shells, CLAUDE.md sync: DONE. Migration `20260506162543_phase_3_2_schema_augmentation.sql` added `ts_pull_rounds.pending_candidates` + `reeval_last_progress_at`, the `ts_evaluations` history table (admin-only RLS), and `global_settings.cap_alert_sent_this_month`. Stub edge functions `ts-pull-candidates` and `ts-generate-scorecard` deployed to the Supabase project (501 responses; real impl in 3.3 / 3.4).
- 3.3 Roles CRUD + wizard: DONE. `/talent-scout/*` route tree mounted (admin-gated via `<AdminRoute>`), top-nav entry visible only to admins, three-step new-role wizard (`/new/details` → `/new/search` → `/new/scorecard`) with a hiring-manager picker over admin users, Claude-driven scorecard generation, and a single-screen edit + close/reopen at `/roles/:id/settings`. `_shared/anthropic.ts` `callClaude` wrapper landed alongside the real `ts-generate-scorecard`. Lifted: `parseClaudeJson` (edge), `wizardStore`, `defaultEvalPrompt`, `poolStatus`, `scoreColor`. Built fresh for HQ design system: `Stepper`, `RoleStatusPill`, `TagInput`. `CandidateTable` placeholder in place; full port comes in 3.5.
- 3.4 Pull pipeline: DONE. `ts-pull-candidates` ports the source's chunked streaming pipeline (BATCH_SIZE=8 self-invoke via `pending_candidates` jsonb). Service-account Gmail auth (`_shared/gmailServiceAccount.ts`) replaces per-install OAuth refresh tokens. PullDetail page subscribes to `ts_pull_rounds` via Supabase Realtime. Adapted from source: schema renames everywhere; scorecard read from `ts_roles.scorecard` (not separate table); `callClaude('talent_scout', ...)` for scoring with prompt caching; per-evaluation history written to `ts_evaluations`. End-to-end verified: R3 = 4 candidates pulled, scored, persisted with 9 attachments to Storage, $0.24 Anthropic spend.
- 3.5 Candidate detail + re-eval: DONE. CandidateDetail page (recruiter overview, files & materials, top strengths / key gaps, internal notes auto-save, score breakdown by tier, status dropdown, re-evaluate button). `ts-evaluate-candidate` for single re-eval (history INSERT) and `ts-bulk-reevaluate` for role-scoped pool re-eval; round-scoped re-eval lives on PullDetail and uses `overwrite_history: true` since prompt/scorecard changes invalidate prior evals. RoleDashboard restructured around the master pool: 4 stat tiles, last-pull relative time, pull-round cards (3 per row, latest+failed badges, "Show all"), CandidateSearch, CandidateTable. PullDetail mirrors the same pattern, round-filtered. CandidateTable is two-tier (active above, rejected below collapsible) with status-priority sort (Interview → Fast-Track → Consider, then Rejected → Auto-Rejected), shift-click range select, slide-in bulk action bar (Reject/Consider/Fast-Track/Interview/Re-evaluate), inline StatusDropdown per row. Schema: `promote` → `interview` enum rename, `ts_candidates.location` + `ts_candidates.detected_links` added, `ts_role_reeval_status` enum + 7 reeval columns on `ts_roles`. Generate Final Review and Generate Packet placeholder buttons land in 3.6.
- 3.6 Final review + packet: NOT done. **You're picking up here.**

### Locked decisions from the Talent Scout port plan

Resolutions to the six open questions in `docs/talent-scout-port-plan.md` § 8.

- **Q1 (re-eval history): keep history.** New `ts_evaluations` table snapshots scorecard + eval prompt at evaluation time, so old scores stay reproducible when the role's prompt evolves. Latest row's fields are mirrored onto `ts_candidates` for fast list queries.
- **Q2 (pending-candidate parking spot): jsonb on the round.** `ts_pull_rounds.pending_candidates` matches the source pipeline's existing shape; no separate table.
- **Q3 (hiring manager identity): block on first sign-in.** `ts_roles.hiring_manager_id` FKs to `users`, and the new-role wizard looks up by email at submit time. If no `users` row exists yet, role creation is blocked with "Hiring manager must sign in to HQ at least once first." No auto-creating users from email strings.
- **Q4 (notification consolidation): standalone first, fold later.** Phase 3.8 ships `ts-send-pull-notification` standalone so Talent Scout doesn't block on Phase 5 work. Phase 5 folds it into `notifications-dispatch`.
- **Q5 (two packet generators): read both, then consolidate.** Before writing `ts-packet-generate` in Phase 3.6, do a 30-min read of the source `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows (candidate-pool packet vs final-review packet) or one is dead code. Consolidate based on that read.
- **Q6 (anthropic-spend-tracker shape): explicit `callClaude(app, ...)` wrapper.** Single helper in `supabase/functions/_shared/anthropic.ts`. Selects the right key from `ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ` based on the `app` argument. After each successful call, computes cost from the response usage block (incl. prompt-cache discounts) and increments `global_settings.anthropic_spend_current_month_usd`. Emails the admin once per cap crossing, gated by `cap_alert_sent_this_month`. Does NOT refuse calls when over cap — graceful degradation, not a hard failure. Email path is currently a console-log stub; Phase 3.8 wires real notifications.

### Architectural decisions surfaced during Phase 3.4

- **Edge Function self-invocation auth.** The Supabase gateway on this project rejects the service-role bearer token at the verify_jwt layer (likely a new-format-key vs legacy-JWT mismatch). To unstick the chunked self-invoke pattern, `ts-pull-candidates` was deployed with `verify_jwt = false` (per-function override in `supabase/config.toml`) and an `INTERNAL_API_SECRET` shared secret was set as a Supabase secret. JWT validation moved into `_shared/internalAuth.ts`, which accepts: (a) the `x-internal-secret` header match, (b) a direct `SUPABASE_SERVICE_ROLE_KEY` bearer match, or (c) a valid user JWT. Anon callers that slip past the gateway still get 401 from the function. Any future Talent Scout / Venue Scout function that self-invokes will need the same `verify_jwt = false` override; non-self-invoking functions stay on the default `verify_jwt = true`.
- **Realtime publication.** The PullDetail page subscribes to `ts_pull_rounds` `UPDATE` events. The `supabase_realtime` publication on this project starts empty, so `ts_pull_rounds` was added to it via a migration with `REPLICA IDENTITY FULL`. Any future table the UI needs to subscribe to will need the same treatment.
- **All attachments to Storage (drift from source).** Source kept small attachments in Gmail and let the dashboard fetch them on demand via a `gmail-attachment` Edge Function. HQ's port persists every attachment to the `candidate_attachments` bucket regardless of size. Slightly more Storage cost, much simpler download path (`supabase.storage.createSignedUrl`), and no separate Edge Function needed for candidate-detail attachment viewing in 3.5.
- **`ts_pull_rounds` operational columns.** `candidates_found`, `processed_count`, `attempt`, `round_number` added in `20260506175156_phase_3_4_pull_pipeline.sql` so progress and round labels work without joining `ts_candidates` per render. Source's `step_progress` jsonb / `current_step` / `error_log` were dropped — the simpler `processed_count / candidates_found` is enough for the test path; richer progress UI can be added back later if needed.

### Architectural decisions surfaced during Phase 3.5

- **Re-eval history retention with one bulk-overwrite escape hatch.** `ts_evaluations` is a history table — every single re-eval (from CandidateDetail's button or the row-level Re-evaluate selected bulk action) INSERTs a new row, preserving prior scores for audit. Bulk re-evaluate at the role or round level (the "Re-Evaluate Pool" action) is the exception: it implies the prompt or scorecard changed, so prior evals are no longer meaningful. The `overwrite_history: true` flag on `ts-evaluate-candidate` deletes prior rows for that candidate before inserting. The candidate-detail UI shows only the latest fields (mirrored onto `ts_candidates`); history accumulates server-side without UI surface yet.
- **`promote` → `interview` enum rename.** Original schema used `promote` as the "advance" status. Renamed to `interview` in Phase 3.5 — concrete next-stage action that maps to actual hiring workflow language. `ts_candidate_status` is now `(consider, interview, reject, fast_track, auto_rejected)`.
- **Status priority is the primary sort everywhere.** `CandidateTable` always sorts by status bucket first (Interview → Fast-Track → Consider in active tier; Rejected → Auto-Rejected in the collapsible rejected tier), then by the user-selectable column. Buckets never interleave regardless of column or direction. The active/rejected divider is collapsible inline, not a separate table.
- **Bulk re-eval is role-scoped, with a parallel-fan-out variant on PullDetail.** `ts-bulk-reevaluate` (chunked self-invoke, `verify_jwt = false`) operates on the role's master pool with optional `status_filter`. PullDetail's "Re-Evaluate Pool" is round-scoped and skips the dedicated function — instead, it fans out parallel `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true`. Floating bottom-right widget shows progress; cancellable mid-run.
- **Round-scoped state on `ts_pull_rounds`, role-scoped state on `ts_roles`.** Source repo put bulk-reeval state on `pull_rounds`. HQ Phase 3.5 spec moved to role-scoped, so the `reeval_status` / `reeval_total` / `reeval_processed` / `reeval_failed` / `reeval_started_at` / `reeval_completed_at` / `reeval_last_progress_at` columns live on `ts_roles`. The legacy `ts_pull_rounds.reeval_last_progress_at` from Phase 3.2 is dead (drop in a future cleanup).
- **Status dropdown writes are awaited before parent refetch.** `StatusDropdown.onValueChange` awaits the DB UPDATE before calling its `onChange` callback (which triggers parent reload). Calling onChange first races the write and leaves the displayed value one click behind. Future inline-mutation components in HQ should follow the same order.

## Picking up at Phase 3.6

### Phase 3.6: Final review + packet

Build the comparative-final-review flow + packet PDF generation. Per the port plan section 9 + the disabled placeholders already wired into RoleDashboard (Generate Final Review + Top-N input) and PullDetail (Generate Packet + Top-N input), this phase ships:
- Edge function `ts-final-review(role_id, candidate_count_limit?)` that compares the master pool comparatively (not per-candidate), produces a pool summary + final rankings jsonb, writes to `ts_final_reviews`. Updates `ts_roles` (or final-review-aware status pill) so the "Final Report" indicator on `RoleStatusPill` lights up.
- Edge function `ts-packet-generate(role_id, pull_round_id?, candidate_count?)`. **Q5 follow-up needed first**: read the source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows (candidate-pool packet vs final-review packet) or one is dead code; consolidate into one HQ function based on that read.
- Pages: `FinalReviewLoading` (realtime sub on a generation status field), `FinalReviewDetail` (renders the pool summary + ranked list with rationale per candidate). Wire the disabled buttons + Top-N inputs on RoleDashboard / PullDetail to fire the new functions.

Heads up before starting Phase 3.6:
- Final review consumes the entire master pool's structured data — likely large prompt. Anthropic prompt caching with the role context block earns its keep here (1-hour TTL, same cache key per role).
- Packet generation needs to talk to Google Slides + Drive APIs (already proven via the service account; scopes confirmed). Use `_shared/gmailServiceAccount.ts` as the template; same JWT bearer flow with different scopes.
- Both functions self-invoke for long runs. Add `[functions.<name>] verify_jwt = false` to `supabase/config.toml` for each, per the pattern in the auth model section.
- Future migrations creating tables MUST include explicit GRANTs to `authenticated` and `service_role`. Auto-expose stays off as the project security default.

## Beyond Phase 3

Phase 3 (Talent Scout) goes BEFORE Phase 4 (Venue Scout). Sequential, not parallel. Talent Scout fully working before Venue Scout starts.

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