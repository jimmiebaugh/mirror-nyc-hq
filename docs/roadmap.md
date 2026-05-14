# Roadmap

Phase-by-phase build plan. Finished phases summarize to one line; the next phase has full detail. Update this doc when phases complete.

For granular project state and the latest commit hash, see `CHECKPOINT.md` at the repo root.

## Phase 1: Foundation. DONE.

Supabase project, Google Cloud Console OAuth client, service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly` / `gmail.send` / `drive` / `presentations`, GitHub repo, Netlify import, local toolchain. Service account verification script lives at `scripts/verify-service-account.ts`.

## Phase 2: Schema and auth. DONE.

Initial schema migration (`20260506061457_initial_schema.sql`): 22 tables, enums, helper + trigger functions, RLS policies, 5 storage buckets. Jimmie seeded as admin. Sanity test: `/projects` query fixed for new schema, types regenerated, GRANTs migration (`20260506065157_grant_data_api_access.sql`) applied.

## Phase 3: Talent Scout port. DONE.

Lifted from `mirror-talent-scout`. Full pipeline ported and deployed. Sub-phase summary:

| Sub-phase | Summary |
|---|---|
| 3.1 | Inventory + port plan (`docs/talent-scout-port-plan.md`). |
| 3.2 | Schema augmentation (`ts_evaluations`, `ts_pull_rounds` extensions, `cap_alert_sent_this_month`); edge function shells. |
| 3.3 | Roles CRUD + 3-step new-role wizard; `_shared/anthropic.ts callClaude` wrapper. |
| 3.4 | `ts-pull-candidates` (chunked self-invoke, BATCH_SIZE=8); service-account Gmail; Realtime on pull rounds. |
| 3.5 | CandidateDetail + status dropdown + re-eval (single + round + role-scoped); `promote` to `interview` enum rename. |
| 3.6 | Final review (`ts-final-review`) + packet generation (`ts-final-review-packet` via pure pdf-lib + signed URL email). OAuth pivot to `sb_publishable_*` keys. |
| 3.7 | Manual-reviewed flag, CandidateDetail layout reorg, Global Settings + competitor list, referral ingestion (Gmail forward chain walker). |
| 3.8 | pg_cron + 6 cron jobs (scheduled pulls, 3 watchdogs, storage cleanup, monthly spend reset); cap-alert email path. |
| 3.9 | `ts-send-pull-notification` (fires from pull complete; folds into `notifications-dispatch` in Phase 5). |
| 3.10 | `ts-refine-scorecard` + wizard step-3 Process/Save morph. |
| 3.11 | Scorecard `full_points_rubric` + `summary` two-field design (restore substantive describers). |

**Final Review packet feature flag (`PACKET_FEATURE_ENABLED`)** was removed from `FinalReviewDetail.tsx` in the TS Final Review packet restore (commit `6775429`); the Generate Packet button on the Final Review page is always live. The round-scoped flag in `PullDetail.tsx` still defaults `false` pending the WORKER_RESOURCE_LIMIT smoke.

### Phase 4: Venue Scout port. DONE.

Shipped to production 2026-05-13 (main at `7cd27ed`). Full 1:1 port from `mirror-nyc-venue-scout-pro`; 4.1-port through 4.10.6-port. Details in `docs/venue-scout-port-plan.md` and `CHECKPOINT.md`.

**Phase 4 Revision - Intake.** Follow-on revision (2026-05-14): rebuilt the single-page Brief into a 3-step stepper (Event -> Venue -> Review), added the venue-side fields the AI sourcing prompt needs, added the `vs-generate-brief-overview` edge function + the `brief` `current_step` value, and made the Revisit nav always-visible. Spec: `OUTPUTS/phase-4-revision-intake-spec.md`. Phase 4 stays DONE; this is a correction, not a new phase.

### Phase 5: HQ Core (cross-cutting). ACTIVE.

Six surfaces that connect Talent Scout, Venue Scout, and HQ-level concerns. No source repo to port from; each surface gets a Cowork-drafted spec before any code.

**Sub-phase candidates** (ordering subject to Phase 5.1 scoping):

- **5.1 Notifications dispatch.** The foundation. Folds in `ts-send-pull-notification` and the future bell. Provides the event pipeline before Dashboard tiles or in-app bell can wire to it.
- **5.2 Dashboard tile grid.** Main landing for authenticated users. Each tile links to a destination (Projects, Venues, Clients, Tasks, Talent Scout, Venue Scout). Needs Projects to exist before it lands.
- **5.3 Real /projects page.** Highest-traffic HQ Core surface. Replaces the current stub. Active scouts, active roles, recent activity, project meta.
- **5.4 /venues, /clients, /tasks pages.** Parallelizable once Projects pattern is set. Each follows the same list-then-detail structure.
- **5.5 Activity log feed.** Cross-cutting. Hooks into project, venue, role, scout, and task triggers. Surfaces in Dashboard plus a dedicated feed page.
- **5.6 Admin pages.** User role management. Global settings UI for fields currently SQL-only (the existing TS Settings and VS Settings pages cover their respective scopes; admin pages cover the rest).

**Order matters:** Dashboard depends on Projects. Notifications can ship in parallel with Dashboard since it is edge-function-plus-table groundwork. Bell UI wires after Dashboard. Activity log lands after enough event triggers exist to populate it.

Per-sub-phase pattern follows `docs/working-with-claude.md` § standard new-surface workflow.

### Phase 6: Cutover. DONE.

Executed 2026-05-13 alongside the Phase 4 wrap. Main hard-reset to `vs-port-fresh` HEAD via `git push origin vs-port-fresh:main --force-with-lease`. 42-commit failed-attempt Phase 4 stack intentionally dropped. Two parallel TS commits (`6775429`, `f24d3f5`) cherry-picked before the push. Subdomain `hq.mirrornyc.com` was already live pre-cutover.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
