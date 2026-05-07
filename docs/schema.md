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
- `reeval_last_progress_at` (timestamptz, nullable): legacy column from Phase 3.2 spec. Phase 3.5 moved bulk-re-eval state to `ts_roles` (role-scoped, not round-scoped); this column is unused and can be dropped in a future cleanup migration.
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
- `status` (enum: `consider`, `interview`, `reject`, `fast_track`, `auto_rejected`). `interview` was renamed from the original spec's `promote` in Phase 3.5. `auto_rejected` is AI-only; admins pick the four manual ones via `StatusDropdown` or the bulk action bar.
- `recruiter_overview` (text)
- `top_strengths`, `key_gaps`, `quick_overview` (jsonb arrays)
- `score_breakdown` (jsonb): `{criterion_name: int}`. Sum of values + competitor bonus = total score.
- `tier` (text), `internal_notes` (text)
- `portfolio_type` (enum: `file`, `url`, `none`), `portfolio_path_or_url` (text)
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

### vs_scouts
- `id`, `name` (text)
- `project_id` (FK to projects, nullable; standalone allowed)
- `phase` (enum: `sourcing`, `deck`, `done`)
- `created_by`, `created_at`, `updated_at`, `last_touched_at`

### vs_briefs (multiple briefs allowed per scout)
- `id`, `scout_id` (FK)
- `source_file_path` (text)
- `client`, `event_name`, `vibe`, `target_audience`, `ideal_features` (text)
- `event_dates_start`, `event_dates_end` (date), `budget` (text)
- `neighborhoods` (text[])
- `square_footage_min`, `square_footage_max` (int)
- `event_overview` (text, editable, used for deck)
- `created_at`, `updated_at`

### vs_sourcing_rounds
- `id`, `scout_id` (FK)
- `source_type` (enum: `uploaded_sheet`, `ai_research`)
- `uploaded_file_path` (nullable)
- `status` (enum: `researching`, `complete`, `failed`)
- `generated_at`

### vs_candidate_venues
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

**Sync rule:** when `shortlisted` flips false to true, OR when an `added_manually` venue's research completes, check HQ `venues` for a match (by `name + neighborhood` or by `website_url`). If no match, INSERT a new row in `venues` and set `linked_venue_id`. If match, just set `linked_venue_id`. Never update an existing HQ venue row. Implemented by the `vs_candidate_venues_shortlist_sync` Postgres trigger.

### vs_pitch_decks
- `id`, `scout_id` (FK)
- `google_slides_id`, `google_slides_url`, `drive_folder_path` (text)
- `version_number` (int; incremented per regeneration)
- `generated_at`, `generated_by` (FK)

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
- `email_notifications_enabled`, `in_app_notifications_enabled` (bool)
- `updated_at`

A monthly cron (planned, not yet implemented) resets `anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false at the start of each calendar month.

### activity_log
- `id`, `entity_type` (text: `project`, `venue`, `task`, etc.)
- `entity_id` (uuid)
- `action` (text: `created`, `updated`, `status_changed`, `assigned`)
- `actor_id` (FK to users)
- `payload` (jsonb)
- `created_at`

## Postgres triggers

- `vs_candidate_venues_shortlist_sync`: implements the Venue Scout sync rule above.
- `tasks_completed_at_set`: when `tasks.status` flips to `done`, set `completed_at = now()`.
- `activity_log_writer`: on insert/update/status-change to projects, venues, tasks, write an activity_log row.
- `updated_at_auto`: standard updated_at trigger on every table with the column.
- `handle_new_user`: on `auth.users` INSERT, mirror to `public.users` with `permission_role = 'member'`. Runs as service role.

## Conventions for future migrations

- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- **Always use `timestamptz`** for time-of-event columns, `date` for date-only.
- **Realtime tables** must be added to the `supabase_realtime` publication and have `REPLICA IDENTITY FULL` if the UI subscribes via `postgres_changes`.
- **Storage bucket conventions** in `docs/auth-model.md`.
