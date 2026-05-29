# Mirror NYC HQ

You're working with **Jimmie Baugh**, Senior Producer at Mirror NYC, an experiential events agency in NYC. He's building **Mirror NYC HQ**, an internal web app that replaces scattered Google Sheets and Drive folders with a relational, Notion-style central database, plus two embedded modules (**Talent Scout**, **Venue Scout**) for hiring and venue-sourcing workflows.

Jimmie is not a developer. Light HTML/CSS, fluent designing AI workflows. The goal is for you to do the heavy lifting (backend + frontend) while he drives architectural decisions and design direction. **As of 2026-05-08, all UX/UI work happens directly in Claude (Cowork for wireframing + design specs, Code for implementation). Lovable is no longer used.** Jimmie runs Claude Code via both the desktop app and the CLI (CLI adopted 2026-05-27). CLI sessions are the primary implementation surface; the desktop app is used for Cowork. CLI commands (`cd`, `claude`) are fine to reference. New surfaces extend the design system Talent Scout established -- see `docs/design-system.md` for canonical layout, component, and behavioral patterns.

## How to talk to Jimmie

- Casual, direct, friend-who-knows-this-stuff tone.
- **No em dashes anywhere.**
- No filler affirmations ("Great question!", "Absolutely!", etc.).
- Concise by default; go deeper when the task calls for it.
- Recommend, don't just present options. Give your read with the tradeoff stated plainly.
- Reference only the latest version of anything he's submitted; if something changed, the old version is gone.
- Don't fill in gaps. If something is unclear or missing, ask him.

Full conventions in `docs/conventions.md`.

## Where to find things

This file is a lean index. Specialized docs in `docs/` are the source of truth for each topic. Read the relevant one before starting work.

| Topic | Doc | What's in it |
| --- | --- | --- |
| Stack, hosting, routing, project layout | `docs/architecture.md` | React + Vite + Supabase + Netlify; monolith with `/talent-scout` and `/venue-scout` routes; where files live. |
| Database schema | `docs/schema.md` | Every table, column, enum, trigger. Single source of truth. Update in the same commit as schema migrations. |
| Auth, RLS, storage, service account | `docs/auth-model.md` | Permission roles (admin/standard/freelance/pending), RLS policies, storage buckets, Google service account, Edge Function self-invocation auth pattern. |
| Edge Functions | `docs/edge-functions.md` | Every `ts-*` / `vs-*` / cross-cutting function, its signature, and `verify_jwt` posture. Includes the `callClaude` wrapper. |
| Cron jobs | `docs/cron-jobs.md` | `pg_cron` schedules, watchdog pattern, what each job does. |
| Conventions | `docs/conventions.md` | How to write migrations, edge functions, components. Naming, tone, git. **Read before making changes.** |
| Design system | `docs/design-system.md` | Tokens, layout, type, components, behavioral patterns. Canonical reference for any new HQ surface. **Read before designing any new page or component.** |
| Decisions | `docs/decisions.md` | Architectural decisions with rationale, indexed by phase. Why bulk re-eval overwrites but single re-eval appends, why `promote` → `interview`, etc. |
| Operations | `docs/operations.md` | Day-to-day commands (migrate, deploy, regen types, tail logs) + common debugging recipes. |
| Roadmap | `docs/roadmap.md` | Phase-by-phase plan. Finished phases summarize to one line; the active phase has full detail. |
| HQ v1 changelog | `docs/v1-changelog.md` | Internal release notes, Phase 3 through 6.0. Authoritative for post-history-rewrite SHAs. |
| Living state | `CHECKPOINT.md` | Latest commit, current phase, what's deployed, recent migrations, known drift. **Update every commit to main.** |
| Session playbook | `docs/working-with-claude.md` | How to set up Cowork + Code sessions effectively for HQ work. Subagent definitions, hook configs, slash commands, anti-patterns to avoid. **Read at the start of any new phase.** |

## Quick orientation

- **Monolith.** One repo, one app, one DB. Talent Scout and Venue Scout are routes inside HQ, not separate apps.
- **Stack:** React + Vite + TS + Tailwind + shadcn/ui (frontend), Supabase Postgres + Edge Functions + Storage + Realtime (backend), Netlify (hosting), Anthropic API + Google Workspace via service account (integrations).
- **Production URL:** `hq.mirrornyc.com` → `mirrornyc-hq.netlify.app`.
- **Supabase project ref:** `amipjjmphblfxpghjnel`.
- **Service account:** `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly`, `gmail.send`, `drive`, `presentations`.

## Current phase

See `CHECKPOINT.md` for live state. `docs/v1-changelog.md` carries the full per-phase ship table. `docs/roadmap.md` carries the forward plan.

## Working with this repo

1. **Before making changes**, scan `docs/conventions.md` and the topic-specific doc for what you're touching.
2. **Schema changes** → write the migration, regenerate types (`supabase gen types typescript --linked`), update `docs/schema.md` in the same commit.
3. **New Edge Function** → think through whether it self-invokes; if yes, set `verify_jwt = false` and pick the auth helper by surface: `requireInternalOrAdminUser` for admin-only / service-role surfaces (Talent Scout), `requireInternalOrUserAuth` only for machine-only / cron surfaces. See `docs/auth-model.md` (canon).
4. **Anthropic calls** go through `callClaude(app, ...)` from `_shared/anthropic.ts`. Never raw fetch.
5. **After merging to main**, update `CHECKPOINT.md` (latest commit, recent commits, known drift).
6. **Phase boundaries** → summarize the finished phase to one line in `docs/roadmap.md`, expand the next phase with full detail.
7. **Decisions worth preserving** → add to `docs/decisions.md` with rationale, don't bury in commit messages.
8. **Deploy policy.** Netlify charges credits per deploy. Feature work lives on a feature branch (e.g. `phase-5-1-notifications`). Commits stay local; the only Netlify-deploy event per phase is the eventual squash-merge to `main`, and Jimmie has to explicitly approve that. Do NOT push to `main` or to any remote feature branch (origin pushes can fire deploy previews) until Jimmie says go. Edge function deploys (`supabase functions deploy`) and DB migrations (`supabase db push --linked`) are out-of-band and fine to apply during feature work; they don't burn Netlify credits.
9. **Two-session discipline.** Cowork (spec drafting) and Code (implementation) both edit files. To avoid clobbering, Cowork is read-only on the repo while any `claude/*` feature branch is active; doc-update intent queues in `OUTPUTS/REPO_DOC_UPDATES.md` for Code to apply. Pre-flight check + full rule in `docs/working-with-claude.md` § Two-session discipline. Read at the start of every session.

## Code observations

After completing each task, log noteworthy unresolved follow-up findings you encountered while reading or working with the codebase into [code-observations.md](code-observations.md). The file persists across sessions so the team can triage during dedicated cleanup passes. Do not add new rows for issues fixed in the same task, resolved hotfixes, or narrative summaries of completed work. Those belong in the relevant repo docs, CHECKPOINT, changelog, or commit message. Existing observation rows can be marked resolved when later work fixes them. See the file's header for entry format, severity tags, and the verify or resolve lifecycle.

**What to look for** (only things you actually encountered; do not go hunting):

- **Unfinished implementations**: TODOs, stubs, placeholder logic, partially implemented features.
- **Dead code**: unused functions, unreachable branches, commented-out blocks.
- **Possible bugs**: unchecked errors, race conditions, off-by-ones, logic errors.
- **Unusual patterns**: inconsistent conventions, surprising workarounds, anti-patterns.

**How to log:**

1. If the finding remains open at the end of the task, append a row to the matching section's table in `code-observations.md` (Frontend / Edge Functions / Database / Build & Tooling / Docs / Other). The header at the top of that file documents the exact column format, severity tags, and the `☐` / `☑` status glyphs.
2. Get the introducing commit's short hash via `git blame -L <line>,<line> <file>` and put it in the Hash column (backtick-wrapped). For non-code observations write `n/a`.
3. Append-only. Never reorder or delete rows. Use the V / R status columns and strikethrough rules defined in the file for state changes.

**In your end-of-turn response**, mention findings only if directly relevant to the current task. Otherwise say "N new observations logged" so the user knows the log moved without re-listing everything. If there is nothing to log this turn, skip the section entirely.

## Notes

- Jimmie's git commit author email: `jimmie@jimmiebaugh.com`. His Mirror NYC email is the auth identity, not the commit identity.
- Working pattern (as of 2026-05-08): Jimmie drafts wireframes + design specs in his Cowork session, then pastes the spec into Code as the implementation prompt. UI/UX no longer scaffolded in Lovable; all design happens in Claude. New surfaces extend Talent Scout's patterns per `docs/design-system.md`.
- HQ Lovable draft was discarded; we started fresh in Phase 2.1.
- Talent Scout source repo (`mirror-talent-scout`) is cloned locally; reference for Phase 3 only. New design work for Phase 4 / 5 happens in Claude, not by porting from Lovable.
