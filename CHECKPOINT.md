# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** **Phase 6.0 (HQ v1.0).** Post-v1 full-site smoke punch-list + T1 tech-debt pass + close doc lean-down, collapsed into ONE squash to `main` and tagged `v1.0`. Scope: the five UX clusters 6.1-6.5 (table system, card/grid canon, DateField, per-surface forms, global behaviors); the T1 tech-debt remediation (F001 admin gate + Top-5 + quick-wins); the doc lean-down (decisions.md halved, tech-debt de-referenced, self-invoke auth canon fixed). The 3 migrations (`venue_files` / F003 / F004) + 18 edge-fn redeploys were already live out-of-band; the squash carries the frontend + docs. Closes the v1 build cycle. Per-phase narrative in `docs/v1-changelog.md` § 6.0; rationale in `docs/decisions.md` § Phase 6.0. Self-SHA `<pending 6.0 squash>` backfills to the real hash folded into the next change (per [[feedback_no_standalone_backfill_commits]]).

- **Currently deployed to production:** **frontend = Phase 6.0 (HQ v1.0)**, shipped as the single 6.0 squash to `main` (the one Netlify deploy of the phase); the 6.0 UX clusters 6.1-6.5 + the T1 frontend fixes are now live (they were committed-only until this ship). The Phase 6.0 backend was already live out-of-band (F001 admin gate on the 7 `ts-*` fns; the `venue_files` + F003 + F004 migrations; 18 edge-fn redeploys). Predecessors: 5.16 (`f138c23`), 5.15 (`1814867`), 5.14 (`4e67f12`), 5.13 (`2393840`), 5.12 (`ed81c38`).
- **Post-v1 hotfix deployed out-of-band (2026-05-29):** `bulk-import` Edge Function v13 is live. It normalizes spreadsheet-friendly import values before validation/commit (bare domains to `https://...`, comma/currency-formatted numbers to bare numeric strings) and returns row-level validation detail in the 400 `error` field so production no longer surfaces an opaque `400: Validation failed` toast.
- **Recent commits** (newest first, on `main`): `<pending 6.0 squash>` Phase 6.0 (HQ v1.0), the post-v1 smoke + T1 tech-debt + doc lean-down squash (15 branch commits folded in; see `docs/v1-changelog.md` § 6.0). Predecessors: `f138c23` (5.16), `1814867` (5.15), `4e67f12` (5.14), `2393840` (5.13), `ed81c38` (5.12).
- **Recent migrations:** all 3 applied to live out-of-band during the 5.16 cycle — `20260612000000_phase_5_16_1_2_advisor_focused.sql` (bulk-import + trigger-fn GRANT lockdown, 2 RLS init-plan wraps, 6 FK indexes; no schema/type change), `20260611000000_phase_5_16_1_1_briefs_dedupe_policy.sql` (briefs storage-policy dedupe), `20260610000000_phase_5_16_0_freelance_flatten_and_tier_hardening.sql` (`is_active_member()` helper + ~57 RLS rewrites).
- **F001 security fix deployed out-of-band (2026-05-29):** the 7 admin-only Talent Scout edge functions (`ts-pull-candidates`, `ts-bulk-reevaluate`, `ts-evaluate-candidate`, `ts-final-review`, `ts-packet-generate`, `ts-final-review-packet`, `ts-send-pull-notification`) now enforce a server-side `permission_role='admin'` re-check via the new `requireInternalOrAdminUser` (`_shared/internalAuth.ts`), closing the Phase 6.0 tech-debt audit's lone Critical (candidate-PII / IDOR reachable past the client-side-only `<AdminRoute>`). No migration; the edge fns were deployed out-of-band and the code folds into the Phase 6.0 squash. Rationale in `docs/decisions.md` § Phase 6.0.
- **Tech-debt T1 pass closed (2026-05-29).** Frontend fixes (folded into the 6.0 squash, now live): F011/F002/F005 (`syncJoinRows` join-write error surfacing), F006/F018/F024/F045 (correctness), F052/F053/F056/F058/F059/F063 (cleanup). Edge + migrations deployed out-of-band ahead of the squash: F003 (FK ON UPDATE CASCADE on the four user-FKs), F004 (atomic `increment_anthropic_spend` RPC), F019 (MIME header-injection strip), F035 (reeval_total count), F054/F055/F057 (dead code + em dash). 2 migrations + 18 edge functions redeployed. Rationale in `docs/decisions.md` § Phase 6.0. **Deferred findings are tracked as discrete rows in `code-observations.md`** (Frontend #56-#81, Edge Functions #22-#33), with a post-v1.0 backlog pointer in `docs/roadmap.md`.
- **Current phase:** **Phase 6.0 shipped, tagged `v1.0`.** The v1 build cycle is closed. No active build phase; the only open thread is the post-v1.0 backlog (deferred tech-debt in `code-observations.md` + `docs/roadmap.md` § Post-v1.0 backlog), addressed ad hoc.
- **Recent migrations (Phase 6.0), with deploy status:** Two tech-debt migrations applied to live out-of-band 2026-05-29: `20260614000000_phase_6_0_f003_user_fk_on_update_cascade.sql` (4 FK ALTERs to ON UPDATE CASCADE; ON DELETE preserved) + `20260615000000_phase_6_0_f004_increment_anthropic_spend_rpc.sql` (SECURITY DEFINER atomic spend increment, service-role-only). Separately, the 6.4 cluster migration `20260613000000_phase_6_4_venue_files.sql` (venue_files table, hardened-from-start `is_active_member()` RLS + `created_by` ON UPDATE CASCADE) was applied to the linked DB during 6.4 implementation and is confirmed live (`supabase migration list --linked` shows it in both Local and Remote). Frontend `types.ts` regenerated for both the F004 RPC and venue_files.
- **Last updated:** 2026-05-29 (Phase 6.0 ship + `v1.0` tag; v1 build cycle close).

## What's where

- Full per-phase ship history → `docs/v1-changelog.md`.
- Architectural decisions with rationale → `docs/decisions.md`.
- Forward plan + active-phase detail → `docs/roadmap.md`.
- Schema → `docs/schema.md`. Edge functions → `docs/edge-functions.md`. Auth/RLS/storage → `docs/auth-model.md`. Cron → `docs/cron-jobs.md`. Operations → `docs/operations.md`.
- Open passive code findings → `code-observations.md` (unresolved follow-up items only; fixed work belongs in the relevant docs, changelog, CHECKPOINT, or commit message).
- Recent commits → `git log`. Recent migrations → `supabase/migrations/`.

## Known drift / open carry-forwards

Only items that need a fresh eye to act on. Items already triaged into a phase plan or `code-observations.md` belong there, not here.

- **Phase B `name` schema wording LOCKED 2026-05-28** (0 iterations; `code-observations.md` Edge #13 closed).
- **Both xlsx smokes PASSED 2026-05-28:** HQ Bulk Import real `.xlsx` (frontend browser CDN import) + Venue Scout sheet upload (vendored edge xlsx 0.20.3). `npm audit` 0; lint 0.
- **DateRangePicker HQ lift: dual-contract picker shipped as the new `DateField` primitive (Phase 6.3 D3)**, wired on ProjectEdit / ProjectDetail. Rollout to the remaining HQ date surfaces (TaskEdit / DateCell / MirrorHolidaysEditor, `code-observations.md` Frontend #43) is the leftover slice; the VS `DateRangePicker` stays VS-only.
- **Phase 6.0 carry-forwards:** RLS-helper `internal`-schema relocation; revisit the ~25 unused-index drops once production scan stats are meaningful; the ~30 audit-column FK indexes; RoleSettings.tsx + ProjectEdit.tsx god-file splits (Frontend #19 remainder); `vs-generate-deck` neighborhood auto-add into `public.neighborhoods`; VS research-accuracy C3 URL accuracy; per-scout / per-role drilldown UI; month-selector / custom-range UI; toggle-state navigation persistence.

(Self-SHA `f138c23` was backfilled across CHECKPOINT / changelog / roadmap / decisions in the Phase 6.0 doc sweep, 2026-05-29. The 6.0 self-SHA rides as the literal placeholder `<pending 6.0 squash>` in CHECKPOINT / changelog / decisions; it backfills to the real squash hash folded into the next change, no standalone deploy-firing commit.)

## How to update this file

On every meaningful merge and every push to `main`:

1. Bump **Last updated** to today.
2. Replace **Active phase** with the new sub-phase: status + commit hash + pointers to its `docs/decisions.md` entry and (once it deploys) its `docs/v1-changelog.md` section.
3. Update **Currently deployed to production** if the push fired a Netlify deploy.
4. Add anything to **Known drift** that doesn't fit an existing phase plan or observation row.

History does not live here. Phase-by-phase ship narrative belongs in `docs/v1-changelog.md`. Decisions belong in `docs/decisions.md`. Recent commits + recent migrations belong in `git log` and `supabase/migrations/`.
