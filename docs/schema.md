# Schema

Single source of truth for the Mirror NYC HQ Postgres schema. All timestamp columns use `timestamptz` (timezone-aware). Date-only columns use `date`. UUIDs use `gen_random_uuid()` defaults.

Migrations live in `supabase/migrations/`. The current migration set was applied through Phase 3.5; see `docs/roadmap.md` for the timeline.

## HQ Core

### users (synced from auth.users via `handle_new_user` trigger)
- `id` (uuid, PK, FK to `auth.users.id` ON DELETE CASCADE)
- `email` (text, unique, not null)
- `full_name` (text)
- `avatar_url` (text)
- `permission_role` (enum: `member`, `producer`, `admin`; default `member`)
- `department_tags` (text[]; allowed values: 'Account Manager', 'Production', 'Design', 'Creative'; users self-tag)
- `active` (bool, default true; soft-delete column)
- `created_at`, `updated_at`

### clients
- `id` (uuid, PK)
- `name` (text, not null)
- `contact_name`, `contact_email`, `contact_phone` (text)
- `notes` (text)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`

### projects
- `id` (uuid, PK)
- `name` (text, not null)
- `client_id` (uuid, FK to clients, nullable)
- `status` (enum: Quoting, Quote Sent, On Hold, Awaiting FB, Awaiting Files, Awaiting Approval, In Progress, Complete, In Production, Event Live, Billing, Proof Out, Location Scouting, In Review). May be refined later.
- `live_dates_start`, `live_dates_end` (date, nullable)
- `production_folder_url`, `design_decks_folder_url`, `budget_sheet_url`, `latest_creative_deck_url`, `slack_channel_url` (text, all nullable)
- `notes` (text)
- `archived_at` (timestamptz, nullable; null = active, non-null = archived; default queries filter `archived_at IS NULL`)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`

### project_account_managers (join, every project must have at least one row)
- `project_id`, `user_id` (PK composite)

### project_designers (join, optional)
- `project_id`, `user_id` (PK composite)

### project_venues (join, multi-venue per project)
- `project_id`, `venue_id` (PK composite)
- The Notion-style backlist on a Venue page queries this to show every project that's used or is using the venue.

### venues
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

### venue_types (lookup; values pending from Jimmie at Phase 4)
- `id` (uuid, PK), `name` (text, unique, not null), `created_at`

### tasks
- `id` (uuid, PK)
- `title` (text, not null), `description` (text)
- `project_id` (uuid, FK, nullable for personal tasks)
- `assignee_id` (uuid, FK to users, nullable)
- `created_by` (uuid, FK to users, not null)
- `status` (enum: `todo`, `in_progress`, `blocked`, `done`)
- `due_date` (date, nullable)
- `created_at`, `updated_at`, `completed_at`

## Talent Scout (siloed from HQ)

Source of truth for the user-facing flow is Jimmie's screen-by-screen spec (he can paste on request) and `docs/talent-scout-port-plan.md`.

### ts_roles
- `id`, `title`, `location`, `type`, `compensation`, `start_date`, `job_description`, `hiring_priorities`
- `hiring_manager_id` (FK to users; must be admin, enforced in app)
- `scorecard` (jsonb: array of `{criterion, tier, weight, max_points}`)
- `evaluation_prompt` (text, editable per role)
- `competitor_bonus` (jsonb: `{competitors: [], bonus_points: 0}`)
- `email_keywords` (text[]), `email_search_start_date` (date)
- `auto_pull_schedule` (enum: `off`, `daily`, `every_3_days`, `weekly`)
- `auto_rejection_threshold` (int)
- `status` (enum: `open`, `closed`), `closed_at` (timestamptz)
- `reeval_status` (enum: `idle`, `running`, `complete`, `failed`), `reeval_status_filter` (text)
- `reeval_total`, `reeval_processed`, `reeval_failed` (int): per-run counters for `ts-bulk-reevaluate`.
- `reeval_started_at`, `reeval_completed_at`, `reeval_last_progress_at` (timestamptz): bulk re-eval timestamps. `reeval_last_progress_at` is the heartbeat the re-eval watchdog (Phase 3.7) reads to detect stalled runs.
- `created_by` (FK), `created_at`, `updated_at`
- Daily cron purges where `closed_at` > 60 days ago, cascading.

### ts_pull_rounds
- `id`, `role_id` (FK)
- `pulled_from`, `pulled_to` (timestamptz; may be incremental)
- `status` (enum: `running`, `complete`, `failed`, `stalled`)
- `triggered_by` (enum: `manual`, `scheduled`)
- `started_at`, `completed_at`, `created_by` (FK)
- `round_number` (int): `R1`, `R2`, ... per role. Set at insert time as `max(round_number) + 1` for the role.
- `candidates_found`, `processed_count`, `attempt` (int): operational counters used by progress UI and watchdog.
- `pending_candidates` (jsonb, default `[]`): queue of Gmail message IDs the chunked pull pipeline batches in groups of 8 across self-invocations.
- `packet_url` (text, nullable): Storage path for the most recent round packet PDF.
- `packet_top_n` (int), `packet_include_fast_track` (bool), `packet_generated_at` (timestamptz): metadata for the most recent packet generation. Updated by `ts-packet-generate` on success.
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` so PullDetail's `postgres_changes` UPDATE subscription receives the full new row.

### ts_evaluations (history table; one row per evaluation)
- `id` (uuid, PK)
- `role_id` (FK to ts_roles), `candidate_id` (FK to ts_candidates)
- `scorecard_snapshot` (jsonb, not null): role.scorecard at evaluation time.
- `eval_prompt_snapshot` (text, not null): role.evaluation_prompt at evaluation time.
- `score` (numeric), `score_breakdown` (jsonb)
- `recruiter_overview` (text), `top_strengths` (jsonb), `key_gaps` (jsonb)
- `tier` (text), `internal_notes_at_time` (text)
- `evaluated_at` (timestamptz), `triggered_by` (FK to users)
- Index on `(candidate_id, evaluated_at DESC)` for the candidate-detail timeline.
- INSERT-only by default. Bulk re-eval is the one exception — it deletes prior rows for the candidate before inserting via the `overwrite_history: true` flag on `ts-evaluate-candidate`. See `docs/decisions.md` for why.

### ts_candidates
- `id`, `pull_round_id` (FK), `role_id` (FK; denormalized)
- `name`, `email` (text), `applied_date` (date), `gmail_message_id` (text)
- `location` (text, nullable): extracted by Claude from candidate materials, persisted on initial pull / re-eval.
- `score` (numeric)
- `status` (enum: `consider`, `interview`, `reject`, `fast_track`, `auto_rejected`). `interview` was renamed from the original spec's `promote` in Phase 3.5. `auto_rejected` is **deprecated** since Phase 3.7.2.1 — backfilled to `reject` + `manually_reviewed=false` and never written by new code; the enum value is kept for safety. Admins pick the four manual statuses via `StatusDropdown` or the bulk action bar.
- `manually_reviewed` (bool, default false; Phase 3.7.2): one-way flip from auto → manual. AI eval / re-eval leaves it false; user actions flip it to true (status-dropdown change or re-select-same, click on the AUTO pill, bulk action). When true, single + bulk re-eval update score / breakdown / strengths / gaps / overview but do NOT touch status. Bulk re-eval's default `not_manually_rejected` filter is `status.neq.reject,manually_reviewed.eq.false`.
- `is_referral` (bool, default false; Phase 3.7.7), `referrer_email` (text, nullable; Phase 3.7.7): set by `ts-pull-candidates` when a `*@mirrornyc.com` manager forwards a candidate to jobs@. Identity on the row stays the original applicant's; `referrer_email` captures the outermost forwarder. Eval is blind to referral status.
- `recruiter_overview` (text)
- `top_strengths`, `key_gaps`, `quick_overview` (jsonb arrays)
- `score_breakdown` (jsonb): `{criterion_name: int}`. Sum of values + competitor bonus = total score.
- `tier` (text)
- `internal_notes` (text): hand-edited on CandidateDetail and pre-populated on referral ingestion when a Mirror manager forwarded with commentary. Phase 3.7.8.16's `extractManagerNote` walks every forward-chain segment and captures every `@mirrornyc.com` sender's commentary (Mirror sigs stripped via the bolded-name + brand-marker heuristic; "from-mobile" sigs stripped via signature-only filter). Folded into the FIRST evaluation via the `HIRING MANAGER NOTES:` block, and re-folded on every re-eval.
- `portfolio_type` (enum: `file`, `url`, `none`), `portfolio_path_or_url` (text). `mirrornyc.com` is in `BLOCKED_PORTFOLIO_DOMAINS` (Phase 3.7.8.15) so manager email-signature URLs never become portfolio URLs.
- `detected_links` (jsonb, default `[]`): array of `{url, type}` for every URL extracted from email body + attachments + bare-domain mentions, classified into `vimeo_reel | drive_folder | portfolio_site | other`. Surfaced in CandidateDetail's Files & Materials section.
- `email_body_text` (text, nullable; Phase 3.6): plain-text application email body, trimmed at 30k chars. Populated by `ts-pull-candidates`. Used by `ts-packet-generate` / `ts-final-review-packet` to render each candidate's email page inside the packet PDF; pages are skipped when this column is null (pre-3.6 candidates).
- `last_evaluated_at`, `created_at`, `updated_at`

### ts_candidate_attachments
- `id`, `candidate_id` (FK)
- `attachment_type` (enum: `resume`, `cover_letter`, `portfolio`, `email_pdf`, `other`)
- `file_name`, `file_path` (text; Storage path under `candidate_attachments` bucket), `file_size_bytes` (int), `created_at`
- Daily cron: purge files for closed-role candidates > 90 days, rejected-candidate files > 30 days.

### ts_final_reviews
- `id`, `role_id` (FK), `candidate_count_limit` (int, nullable)
- `status` (enum `ts_final_review_status`: `generating`, `complete`, `failed`; default `generating`)
- `step_progress` (jsonb): drives FinalReviewLoading's 3-step list. Keys: `aggregate`, `build`, `rank`. Each value: `{status: pending|active|done, count?, label?}`.
- `candidate_count` (int): resolved Master Pool size at generation time.
- `pool_summary` (text)
- `final_rankings` (jsonb): `[{candidate_id, final_rank, final_tier, rationale, recruiter_note, final_overview}]` where `final_overview` is a `string[]` of 4-6 short headlines per candidate. See `docs/decisions.md` § Phase 3.6.
- `duration_seconds` (int): wall-clock for the AI call. Surfaced in the history list.
- `error_message` (text), `error_log` (jsonb, default `[]`): set when `status = 'failed'`.
- `claude_raw_response` (jsonb, nullable): kept for debugging.
- `packet_url` (text, nullable), `packet_top_n` (int), `packet_include_fast_track` (bool), `packet_generated_at` (timestamptz): metadata for the most recent final-review packet. Updated by `ts-final-review-packet`.
- `triggered_by` (FK), `generated_at`
- Index on `(role_id, status, generated_at DESC)` for the FinalReviewDetail "load latest complete review" query and the history list.
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` so FinalReviewLoading's `postgres_changes` UPDATE subscription on `step_progress` receives the full new row.

## Venue Scout (linked to HQ)

Three-table schema landed in Phase 4.1-port (`20260512200000_phase_4_1_port_schema.sql`). Replaces the failed-attempt Phase 4 shape from main with the 1:1 port from `mirror-nyc-venue-scout-pro`. The earlier `vs_briefs`, `vs_sourcing_rounds`, and `vs_pitch_decks` tables were dropped per the locked decisions in `docs/venue-scout-port-plan.md`:
- § 8.1 single-round per scout (no `vs_sourcing_rounds`)
- § 8.2 brief inline on `vs_scouts` (no `vs_briefs`)
- § 8.5 deck history as `vs_scouts.generated_decks` jsonb array (no `vs_pitch_decks`)
- § 8.6 RLS open to all authenticated (collaborative agency-wide workflow)

### vs_scouts
- `id` (uuid, PK), `name` (text, NOT NULL)
- Brief fields inline (port plan § 8.2):
  - `client_name`, `event_name`, `live_dates`, `city` (text)
  - `budget` (numeric)
  - `brief_data` (jsonb, default `{}`): flexible per-scout extras the producer surfaces from the uploaded brief PDF
  - `event_overview` (text)
- `current_step` (text, NOT NULL, default `sheet_prompt`, CHECK in 9 values from VS Pro: `sheet_prompt`, `sheet_upload`, `researching`, `sourcing_report`, `shortlist`, `review_selects`, `compiling`, `deck_prep`, `completed`): workflow state machine per port plan § 8.4. Drives every page's continue logic via `stepToRoute()` (`src/lib/venue-scout/format.ts`, lands in Phase 4.2-port).
- `status` (text, NOT NULL, default `draft`): VS Pro carries this independent of `current_step`; kept for parity.
- `sheet_storage_path` (text, nullable): path under `sourcing_sheets` storage bucket
- `derived_columns` (jsonb, default `[]`): array of `{id, label, criteria}` alignment columns the AI selected for the single sourcing pass (collapsed onto the scout per § 8.1).
- `generated_decks` (jsonb, default `[]`, port plan § 8.5): deck history as array of `{deck_id, deck_name, version, generated_at, venue_count, slide_count, edit_url, embed_url}`. Replaces the separate `vs_pitch_decks` table.
- `deck_order` (jsonb, default `[]`): producer-controlled venue order for deck slides
- HQ-specific operational columns (no VS Pro analog):
  - `project_id` (uuid, FK to `projects`, nullable; standalone scouts allowed)
  - `archived_at` (timestamptz, nullable; null = active, non-null = archived)
  - `created_by`, `updated_by` (uuid, FK to users)
  - `last_touched_at` (timestamptz, NOT NULL, default `now()`): tracks meaningful user activity (sourcing kick-off, brief save, deck generated). Drives the Scout Index sort.
- `created_at`, `updated_at`
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` (port plan § 8.3) so the Researching / Compiling / Generating loading pages can subscribe to `current_step` changes via `postgres_changes`.

### vs_candidate_venues
Maps to VS Pro `venues` (renamed because HQ already has a `venues` table for the master venue list). VS Pro's `venue_notes` collapsed inline as `notes` per port plan § 2.

- `id` (uuid, PK)
- `scout_id` (uuid, FK to `vs_scouts`, ON DELETE CASCADE)
- `linked_venue_id` (uuid, FK to HQ `venues`, ON DELETE SET NULL): set by the shortlist sync trigger when a candidate flips into the master HQ venues table. Trigger lands when the Shortlist surface ports (Phase 4.6-port); column reserved here.
- `name` (text, NOT NULL), `neighborhood`, `address` (text)
- `venue_type` (text): VS Pro stores `type`; renamed because `type` reads as a system word in TS / Postgres tooling
- `key_features` (text[], default `{}`)
- `website_url` (text)
- `size_sq_ft` (int), `capacity` (int)
- `derived_attrs` (jsonb, default `{}`)
- `recommendations`, `considerations` (text[], default `{}`): bullet lists from AI research
- `rank` (int, CHECK 0-100 or NULL): VS Pro stores `ranking_score`; renamed for parity with HQ Talent Scout's score naming
- `source` (text, NOT NULL, default `manual`, CHECK in `sheet`, `research`, `manual`)
- `shortlisted`, `pitched` (bool, default false), `include_in_deck` (bool, default true)
- `venue_overview` (text): AI-generated venue summary written by `vs-compile-summaries` (Phase 4.7-port)
- `notes` (text): inlined from VS Pro `venue_notes`. Free-text matrix notes
- `pitch_notes` (text): pitch-context notes from Shortlist
- `created_at`, `updated_at`

**Sync rule** (trigger lands in Phase 4.6-port, when the Shortlist surface ports): when `shortlisted` flips false to true, check HQ `venues` for a match (by `website_url` first, then by case-insensitive `name + neighborhood`). If no match, INSERT a new row in `venues` and set `linked_venue_id`. If match, just set `linked_venue_id`. Never update an existing HQ venue row. Will be implemented by a simplified `vs_candidate_venues_shortlist_sync` Postgres trigger (the failed-attempt version is dropped in the port migration; the new one fires only on the shortlisted false→true condition).

### vs_venue_photos
Lifted from VS Pro with HQ rename. ON DELETE CASCADE so a Start Over (which deletes all candidate venues for a scout) cleans photos automatically.

- `id` (uuid, PK)
- `candidate_venue_id` (uuid, FK to `vs_candidate_venues`, ON DELETE CASCADE)
- `slot` (int, NOT NULL, CHECK BETWEEN 1 AND 4): `1 = top_left`, `2 = top_right`, `3 = bottom_left`, `4 = bottom_right` on the deck slide. UNIQUE on `(candidate_venue_id, slot)`.
- `storage_path` (text, NOT NULL): path within the `vs_venue_photos` storage bucket (added in Phase 4.7-port when the upload UI ports), format `${scout_id}/${candidate_venue_id}/slot_${N}.${ext}`
- `file_name`, `file_size_bytes` (text / int, nullable)
- `created_at`

## Cross-cutting

### notifications
- `id`, `user_id` (FK; recipient)
- `type` (text: `task_assigned`, `task_due`, `project_updated`, `pull_complete`, `final_review_ready`, etc.)
- `title`, `body`, `link_url` (text)
- `read` (bool), `delivered_in_app` (bool), `delivered_email` (bool)
- `created_at`, `read_at`

### global_settings (single row)
- `id` (uuid, PK)
- `anthropic_spend_cap_monthly_usd`, `anthropic_spend_current_month_usd` (numeric)
- `cap_alert_sent_this_month` (bool, default false): paired with `anthropic_spend_current_month_usd` so the spend tracker emails the admin once per cap crossing instead of every API call after the cap is hit.
- `default_drive_folder_for_standalone_vs_decks` (text)
- `venue_research_priority_sites` (text[]; admin-configurable, NOT a hard restriction)
- `talent_scout_packet_default_count` (int, default 15)
- `talent_scout_competitor_list` (text[], Phase 3.7.5): global default competitor company list applied to every Talent Scout role unless overridden per-role on `ts_roles.competitor_bonus`. Seeded with Mirror's canonical 19-entry default; editable from `/talent-scout/settings` (admin only). Postgres `text[]` rather than jsonb because the value is a flat array — per-role `competitor_bonus` stays jsonb because it carries a `bonus_points` scalar alongside the array.
- `email_notifications_enabled`, `in_app_notifications_enabled` (bool)
- `updated_at`

`ts-cron-monthly-spend-reset` (Phase 3.8) resets `anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false on the 1st of each month at 00:01 UTC.

### activity_log
- `id`, `entity_type` (text: `project`, `venue`, `task`, etc.)
- `entity_id` (uuid)
- `action` (text: `created`, `updated`, `status_changed`, `assigned`)
- `actor_id` (FK to users)
- `payload` (jsonb)
- `created_at`

## Postgres triggers

- `vs_candidate_venues_shortlist_sync`: dropped in Phase 4.1-port. Will be re-introduced in a simpler form (shortlisted false→true only) when the Shortlist surface ports in Phase 4.6-port.
- `tasks_completed_at_set`: when `tasks.status` flips to `done`, set `completed_at = now()`.
- `activity_log_writer`: on insert/update/status-change to projects, venues, tasks, write an activity_log row.
- `updated_at_auto`: standard updated_at trigger on every table with the column.
- `handle_new_user`: on `auth.users` INSERT, mirror to `public.users` with `permission_role = 'member'`. Runs as service role.

## Conventions for future migrations

- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- **Always use `timestamptz`** for time-of-event columns, `date` for date-only.
- **Realtime tables** must be added to the `supabase_realtime` publication and have `REPLICA IDENTITY FULL` if the UI subscribes via `postgres_changes`.
- **Storage bucket conventions** in `docs/auth-model.md`.
